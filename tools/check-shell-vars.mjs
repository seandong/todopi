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
  let single = false, double = false;
  const lines = text.split("\n");
  // 上一行以反斜杠结尾（续行）时，这一行接着上一行的那个词，而不是从新词开始——
  // `echo foo\` 换行接 `#$x，` 里的 # 不开注释（F10 第三轮评审构造的漏报）。
  let continued = null;           // 上一行以续行结尾时，那一刻「是否处在词首」；否则 null
  lines.forEach((line, ln) => {
    // 「上一个字符是没被转义的分隔符」——`#` 只在一个词的开头才开注释。`foo\ #$x` 里的空格被转义了，
    // `#` 仍是同一个词的一部分，bash 会展开后面的 $x（F10 第二轮评审构造的漏报）。
    // bash 把「反斜杠 + 换行」直接删掉、两行拼接，所以这一行开头是不是新词，取决于反斜杠**之前**。
    let atWordStart = continued === null ? true : continued;
    continued = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (single) { if (c === "'") single = false; atWordStart = false; continue; }
      if (c === "\\") {
        if (i === line.length - 1 && !single) continued = atWordStart;  // 行尾的反斜杠：续行
        i += 1; atWordStart = false; continue;
      }
      if (c === "'" && !double) { single = true; atWordStart = false; continue; }
      if (c === '"') { double = !double; atWordStart = false; continue; }
      if (c === "#" && !double && atWordStart) break;                               // 注释
      atWordStart = !double && /[\s;|&()]/.test(c);
      if (c === "$") {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i + 1));
        if (m !== null) {
          const next = line.charCodeAt(i + 1 + m[0].length);
          if (next > 127) out.push([ln + 1, m[0]]);
          i += m[0].length;
        }
      }
    }
  });
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
