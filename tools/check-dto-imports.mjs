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
const EXT = [".ts", ".mts", ".cts"];

/** 递归收集：子目录里的值导入同样是违规，只扫直属文件抓不到。 */
function sourceFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (EXT.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

/**
 * 把注释挖空但保留每个字符的位置（行号因此不变）。
 *
 * 必须同时跟踪字符串状态：先前的实现直接正则删注释，于是字符串里的 `/*`
 * 会让它一路吞到下一个 `*​/`，把中间真正的 import 一起吃掉——那是**漏检**，
 * 比误报危险。这个扫描器同时认单双引号与模板串（含 ${} 嵌套的粗略处理）。
 */
function blankComments(src) {
  const out = Array.from(src);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out[i] = " "; i++; }
    } else if (c === "/" && d === "*") {
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < n) { out[i] = " "; out[i + 1] = " "; i += 2; }
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
    } else {
      i++;
    }
  }
  return out.join("");
}

const Q = "[\"'`]";
for (const file of sourceFiles(root)) {
  const src = readFileSync(file, "utf8");
  const code = blankComments(src);
  const lineOf = (idx) => code.slice(0, idx).split("\n").length;

  // 不锚定行首：同一行上的第二条 import 也要抓到。
  // 覆盖 `import ... from`、`export ... from`（re-export）。
  for (const m of code.matchAll(new RegExp(`\\b(import|export)\\s+(type\\s+)?([^;]*?)\\bfrom\\s*${Q}([^"'\`]+)${Q}`, "g"))) {
    const [, , typeKw, clause, from] = m;
    if (!from.includes("domain/")) continue;
    if (typeKw !== undefined) continue;                    // import type { ... }
    const names = clause.replace(/[{}]/g, "").split(",").map((x) => x.trim()).filter(Boolean);
    const values = names.filter((x) => !x.startsWith("type "));
    if (values.length === 0) continue;                     // 内联的 { type A, type B }
    console.log(`${file}:${lineOf(m.index)}: value import of ${values.join(", ")} from ${from}`);
  }

  // 动态 import() 无法静态判定只取类型，一律视为值导入。模板串说明符同样算。
  for (const m of code.matchAll(new RegExp(`\\bimport\\s*\\(\\s*${Q}([^"'\`]*domain\\/[^"'\`]*)${Q}`, "g"))) {
    console.log(`${file}:${lineOf(m.index)}: dynamic import of ${m[1]}`);
  }
}
