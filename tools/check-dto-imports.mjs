// tools/check-dto-imports.mjs —— ARCH-020 的检查器。
//
// src/output/dto/ 只能从 src/domain/ 做**类型导入**。类型不含行为，搬不动计算；
// 值导入意味着 dto 在调用领域函数，那正是 ARCHITECTURE.md 禁止的「在映射里算派生态」。
//
// 用 node 而不是 grep：import 语句可以跨多行，而 `from "..."` 那一行上看不到
// 前面是 `import` 还是 `import type`，按行 grep 会漏判。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = "src/output/dto";

/** 递归收集：子目录里的值导入同样是违规，只扫直属文件抓不到（实测漏检）。 */
function tsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

for (const file of tsFiles(root)) {
  const src = readFileSync(file, "utf8");
  // 把注释挖空但保留换行：注释里出现 "import" 会让下面的匹配误判，
  // 而直接删掉注释会让行号对不上。
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  for (const m of code.matchAll(/^[ \t]*(?:import|export)\s+(type\s+)?([^;]*?)\bfrom\s*["']([^"']+)["']/gm)) {
    const [, typeKw, clause, from] = m;
    if (!from.includes("domain/")) continue;
    if (typeKw !== undefined) continue;                    // import type { ... }
    // 内联形式 import { type A, type B } 同样是纯类型导入
    const names = clause.replace(/[{}]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
    const values = names.filter((n) => !n.startsWith("type "));
    if (values.length === 0) continue;
    const line = code.slice(0, m.index).split("\n").length;
    console.log(`${file}:${line}: value import of ${values.join(", ")} from ${from}`);
  }
  // 动态 import() 无法静态判定只取类型，一律视为值导入
  for (const m of code.matchAll(/\bimport\s*\(\s*["']([^"']*domain\/[^"']*)["']/g)) {
    const line = code.slice(0, m.index).split("\n").length;
    console.log(`${file}:${line}: dynamic import of ${m[1]}`);
  }
}
