// tools/check-trust-location.mjs —— ARCH-022 的检查器。
//
// spec §8：verify 的信任记录 MUST NOT 存在 .todopi/ 内的任何地方。
//
// 用 node 而不是 grep：规则要查的是**代码**，而这个文件的注释里正好在解释
// 「绝不在 .todopi/ 里」——直接 grep 会把那段解释判成违规。
// 这是 ARCH-001/002/011/013 之后第五次同一类误伤，所以这次直接挖空注释再查。
import { readFileSync } from "node:fs";

const file = "src/exec/trust.ts";
const src = readFileSync(file, "utf8");

// 注释与字符串挖成空格，保留行号
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));

const BANNED = /\.todopi|ledger\.dir|ledgerDir/g;
for (const m of code.matchAll(BANNED)) {
  const line = code.slice(0, m.index).split("\n").length;
  console.log(`${file}:${line}: 信任记录的路径里出现了 ${m[0]}`);
}
