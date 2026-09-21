// tools/check-dto-imports.mjs —— ARCH-020 的检查器。
//
// src/output/dto/ 只能从 src/domain/ 做**类型导入**。类型不含行为，搬不动计算；
// 值导入意味着 dto 在调用领域函数，那正是 ARCHITECTURE.md 禁止的「在映射里算派生态」。
//
// 用 node 而不是 grep：import 语句可以跨多行，而 `from "..."` 那一行上看不到
// 前面是 `import` 还是 `import type`，按行 grep 会漏判。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = "src/output/dto";
for (const name of readdirSync(dir)) {
  if (!name.endsWith(".ts")) continue;
  const src = readFileSync(join(dir, name), "utf8");
  // 把注释挖空但保留换行：注释里出现 "import" 会让下面的匹配误判，
  // 而直接删掉注释会让行号对不上。
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  for (const m of code.matchAll(/^import\s+(type\s+)?([^;]*?)\bfrom\s*["']([^"']+)["']/gm)) {
    const [, typeKw, clause, from] = m;
    if (!from.includes("domain/")) continue;
    if (typeKw !== undefined) continue;                    // import type { ... }
    // 内联形式 import { type A, type B } 同样是纯类型导入
    const names = clause.replace(/[{}]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
    const values = names.filter((n) => !n.startsWith("type "));
    if (values.length === 0) continue;
    const line = code.slice(0, m.index).split("\n").length;
    console.log(`${dir}/${name}:${line}: value import of ${values.join(", ")} from ${from}`);
  }
}
