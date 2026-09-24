// tools/check-shell-vars.mjs —— ARCH-024 的检查器。
//
// 找 shell 脚本里 `$变量` 紧挨着一个非 ASCII 字符的地方：bash 会把那个多字节字符的字节吞进变量名，
// set -u 下直接 unbound variable。
//
// **判据是文字上的相邻，不管上下文**——注释里、单引号里、不展开的 heredoc 里的也报，加花括号即可。
// 第一版就是这样（一条 grep），F10 第一轮评审指出它报了 shell 并不展开的地方，我当时选择把检查收窄到
// 「会被展开的」：逐字符跟踪引号、注释、续行、heredoc……此后四轮评审每轮都在这个手写的 bash 词法里找出
// 漏报，其中两个是我自己的修正引入的；而「会不会被展开」本来就判不全（eval）。同时，整个仓库的脚本里
// 文字上的这种相邻是零处——那个词法分析器要压下去的误报一条都不存在。所以反过来收口：把规则的措辞改成
// 文字判据，检查与措辞完全一致（DECISIONS，F10 第七轮）。
//
// 唯一的预处理是删掉「反斜杠 + 换行」：bash 在分词前就这么做，`echo $x\` 换行接 `，` 会崩。删它只可能
// 拼出新的匹配、不会藏掉一个（它删掉的只有这两个字符），所以不会引入漏报。

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function* shellFiles(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* shellFiles(p);
    else if (p.endsWith(".sh")) yield p;
  }
}

/** 返回违规的 [行号, 变量名]；行号是 `$` 所在的原始行。纯函数，便于用例直接喂字符串。 */
export function findUnbracedVars(text) {
  let joined = "";
  const lineOf = [];
  for (let i = 0, ln = 1; i < text.length; i++) {
    if (text[i] === "\\" && text[i + 1] === "\n") { i += 1; ln += 1; continue; }
    joined += text[i];
    lineOf.push(ln);
    if (text[i] === "\n") ln += 1;
  }
  const out = [];
  for (const m of joined.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)(?=[^\x00-\x7f])/g)) out.push([lineOf[m.index], m[1]]);
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
