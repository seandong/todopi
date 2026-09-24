// tools/check-shell-vars.mjs —— ARCH-024 的检查器。
//
// 找 shell 脚本里**会被展开的** `$变量` 紧挨着一个非 ASCII 字符的地方：bash 会把那个多字节
// 字符的字节吞进变量名，set -u 下直接 unbound variable。
//
// 第一版是一条 grep，它连注释里和单引号里的 `$x，` 也报——shell 并不展开它们（F10 评审）。
// 这是「规则的措辞对，check 比措辞宽」的第九次；grep 看不见引号状态，所以换成这个逐字符的扫描：
// 跨行跟踪单引号（e2e 里大量跨行的 `node -e '...'`），跳过单引号内与注释。
//
// heredoc 正文单独处理：里面的引号是数据，不改变 shell 的引号状态（第五轮评审：正文里一个孤立的 `'`
// 让扫描器以为进了单引号，跳过了后面真正会展开的 `$x，`）。`<<'EOF'` / `<<"EOF"` / `<<\EOF` 的正文不展开，
// 跳过；`<<EOF` 的正文展开，只认反斜杠转义。找不到结束行的 `<<` 不当 heredoc（`(( a<<b ))` 是移位）。
//
// 已知多报（宁可多报——加花括号在那里无害）：双引号里 `$( ... '$x，' ... )` 这种嵌套命令替换中受单引号
// 保护的。

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function* shellFiles(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* shellFiles(p);
    else if (p.endsWith(".sh")) yield p;
  }
}

/** 返回违规的 [行号, 变量名]。纯函数，便于用例直接喂字符串。 */
export function findUnbracedVars(text) {
  const out = [];
  let single = false, double = false, ln = 1;
  // 「上一个字符是没被转义的分隔符」——`#` 只在一个词的开头才开注释。`foo\ #$x` 里的空格被转义了，
  // `#` 仍是同一个词的一部分，bash 会展开后面的 $x（F10 第二轮评审构造的漏报）。
  let atWordStart = true;
  // **按字符流扫，不按行。** bash 在分词之前就把「反斜杠 + 换行」删掉、两行直接拼接（单引号里与注释里
  // 除外）。按行扫时这件事只能靠在行与行之间传状态来模拟，第三、四轮评审各找出一处没传到的：
  // 续行后的 `#`、续行后紧跟变量名的非 ASCII 字符（`echo $x\` 换行接 `，`）。
  const joins = (j) => { while (text[j] === "\\" && text[j + 1] === "\n") j += 2; return j; };
  // 读一个 `$名字`（名字中间可以有被删掉的续行）；紧跟非 ASCII 就记下。返回名字之后的位置。
  const variable = (j, line) => {
    let k = joins(j), name = "";
    while (/[A-Za-z_]/.test(text[k] ?? "") || (name !== "" && /[0-9]/.test(text[k]))) { name += text[k]; k = joins(k + 1); }
    if (name !== "" && text.charCodeAt(k) > 127) out.push([line, name]);
    return name === "" ? j : k;
  };
  const pending = [];             // 这一行上登记了、正文从下一行开始的 heredoc
  // 从 j（正文第一个字符）起依次读完 pending 里每个 heredoc 的正文；有一个找不到结束行就整体放弃，返回 -1。
  const bodies = (j) => {
    const found = [];
    for (const h of pending) {
      let k = j, end = -1;
      while (k < text.length) {
        let nl = text.indexOf("\n", k);
        if (nl < 0) nl = text.length;
        if ((h.strip ? text.slice(k, nl).replace(/^\t+/, "") : text.slice(k, nl)) === h.delim) { end = nl + 1; break; }
        k = nl + 1;
      }
      if (end < 0) return -1;
      found.push([h, j, k]);      // 正文是 [j, k)
      j = end;
    }
    for (const [h, from, to] of found) {
      let line = ln;
      for (let k = from; k < to; k++) {
        if (text[k] === "\n") { line += 1; continue; }
        if (!h.expand) continue;
        if (text[k] === "\\") { if (text[k + 1] === "\n") line += 1; k += 1; continue; }
        if (text[k] === "$") {
          const e = variable(k + 1, line);
          for (let m = k + 1; m < e; m++) if (text[m] === "\n") line += 1;
          k = Math.max(k, e - 1);
        }
      }
    }
    for (let k = pending.length ? found[0][1] : j; k < j; k++) if (text[k] === "\n") ln += 1;
    return j;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") ln += 1;
    if (c === "\n" && !single && !double && pending.length > 0) {
      const next = bodies(i + 1);
      pending.length = 0;
      if (next >= 0) { i = next - 1; atWordStart = true; continue; }
    }
    if (!single && !double && c === "<" && text[i + 1] === "<" && text[i + 2] !== "<") {
      const m = /^<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*))/.exec(text.slice(i, i + 200));
      if (m !== null) {
        pending.push({ strip: m[1] === "-", delim: m[2] ?? m[3] ?? m[4] ?? m[5], expand: m[5] !== undefined });
        i += m[0].length - 1; atWordStart = false; continue;
      }
    }
    if (single) { if (c === "'") single = false; atWordStart = false; continue; }
    if (c === "\\") {
      if (text[i + 1] === "\n") { i += 1; ln += 1; continue; }       // 续行：删掉，词首状态不变
      i += 1; atWordStart = false; continue;
    }
    if (c === "'" && !double) { single = true; atWordStart = false; continue; }
    if (c === '"') { double = !double; atWordStart = false; continue; }
    if (c === "#" && !double && atWordStart) {                        // 注释：到行尾为止，行尾的 \ 不续行
      const nl = text.indexOf("\n", i);
      i = (nl < 0 ? text.length : nl) - 1;
      continue;
    }
    atWordStart = !double && /[\s;|&()]/.test(c);
    if (c === "$") {
      const j = variable(i + 1, ln);
      if (j !== i + 1) {
        for (let k = i + 1; k < j; k++) if (text[k] === "\n") ln += 1;   // 名字中间或后面被删掉的续行
        i = j - 1;
        atWordStart = false;
      }
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const roots = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["tools", "init.sh"];
  for (const root of roots) {
    const files = statSync(root).isDirectory() ? [...shellFiles(root)] : [root];
    for (const f of files) {
      for (const [ln, name] of findUnbracedVars(readFileSync(f, "utf8"))) {
        console.log(`${f}:${ln}: $${name} 紧挨着一个非 ASCII 字符——写成 \${${name}}`);
      }
    }
  }
}
