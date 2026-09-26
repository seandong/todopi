// tools/check-cjk.mjs —— ARCH-014：src/ 的代码行（非注释）里不得出现中文。
//
// 原来是一条 grep 管道，用 [一-鿿] 这样的字符区间认中文。那依赖 locale：POSIX / C locale 下它按字节比，会把 —、…、·
// 也算进去；GNU grep 在某些 UTF-8 locale 下直接报「Invalid collation character」（F21 在容器里实测）。改用码点判断，
// 规则的语义不变：
//   - 含 U+4E00–U+9FFF 的行；
//   - 整行是注释（去掉缩进后以 //、*、/* 开头）的不算；
//   - 中文只出现在行尾的 // 注释里（// 与它之间没有引号）的不算。
// 输出与 grep -rn 相同：<文件>:<行号>:<内容>，没有违规时什么都不输出。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CJK = /[一-鿿]/u;
const COMMENT_LINE = /^[\t ]*(\/\/|\*|\/\*)/;
const TRAILING_COMMENT = /\/\/[^"'`]*[一-鿿]/u;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

for (const root of process.argv.slice(2)) {
  for (const file of walk(root)) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (!CJK.test(line) || COMMENT_LINE.test(line) || TRAILING_COMMENT.test(line)) return;
      process.stdout.write(`${file}:${i + 1}:${line}\n`);
    });
  }
}
