// tools/check-shell-vars.mjs —— ARCH-024 的检查器。
//
// 找 shell 脚本里**会被展开的** `$变量` 紧挨着一个非 ASCII 字符的地方：bash 会把那个多字节
// 字符的字节吞进变量名，set -u 下直接 unbound variable。
//
// 第一版是一条 grep，它连注释里和单引号里的 `$x，` 也报——shell 并不展开它们（F10 评审）。
// 这是「规则的措辞对，check 比措辞宽」的第九次；grep 看不见引号状态，所以换成这个逐字符的扫描：
// 跨行跟踪单引号（e2e 里大量跨行的 `node -e '...'`），跳过单引号内与注释。
//
// 已知多报（宁可多报——加花括号在那里无害）：`<<'EOF'` 这类不展开的 heredoc 正文里的，以及双引号里
// `$( ... '$x，' ... )` 这种嵌套命令替换中受单引号保护的。

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
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") ln += 1;
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
      let j = joins(i + 1), name = "";
      while (/[A-Za-z_]/.test(text[j] ?? "") || (name !== "" && /[0-9]/.test(text[j]))) { name += text[j]; j = joins(j + 1); }
      if (name !== "") {
        if (text.charCodeAt(j) > 127) out.push([ln, name]);
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
