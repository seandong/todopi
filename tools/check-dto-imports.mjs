// tools/check-dto-imports.mjs —— ARCH-020 的检查器。
//
// src/output/dto/ 只能从 src/domain/ 做**类型导入**。类型不含行为，搬不动计算；
// 值导入意味着 dto 在调用领域函数，那正是 ARCHITECTURE.md 禁止的「在映射里算派生态」。
//
// 类型导入与值导入的区分**交给 Node 自带的类型剥离**（一个真解析器），
// 不自己判断：`import type` 与内联的 `{ type A }` 被抹成空白且行号保持不变，
// 所以剥离之后**任何**指向 domain/ 的 import 都是值导入。
// 先前手写这段判断，为了处理跨行 import、内联 type、re-export 叠了一层层近似
// 规则，每一层都漏过东西（Codex 评审连续三轮在这个文件上有发现）。
//
// 剩下要自己做的只有「跳过注释、字符串和正则字面量」，避免把它们里面的文字
// 当成代码。这一步仍是手写扫描，但它的职责小到可以用正反例钉死——见
// tests/harness/check-dto-imports.test.ts。
//
// 用法：node tools/check-dto-imports.mjs [根目录]   （默认 src/output/dto）

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripTypeScriptTypes } from "node:module";

const EXT = [".ts", ".mts", ".cts", ".tsx"];

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
 * 把注释、字符串和正则字面量挖成空格，保留每个字符的位置（行号因此不变）。
 *
 * 索引单位必须自始至终是 UTF-16 码元：先前用 Array.from 建输出数组（按**码点**
 * 拆分），却用 src[i] / src.length 遍历（按码元），一个 emoji 就能让两者错位，
 * 于是后面真正的 import 漏检。split("") 与 src[i] 的单位一致。
 *
 * 正则字面量必须认：`const re = /["']/` 里的引号若被当成字符串开头，
 * 引号状态就此错乱，后面的 import 会被整个吞掉——那是漏检，比误报危险。
 * 判断 `/` 是正则还是除号用的是标准启发式：看上一个有意义的字符。
 */
function blankNonCode(src) {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  let prev = "";                       // 上一个有意义的字符，用来区分正则与除号
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") {
      const start = i;
      while (i < n && src[i] !== "\n") i++;
      blank(start, i);
    } else if (c === "/" && d === "*") {
      const start = i;
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i = Math.min(i + 2, n);
      blank(start, i);
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c, start = i;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      // **不挖空字符串内容**：模块说明符就在里面，抹掉它 import 就无从匹配。
      // 字符串在这里只作为一个要跳过的状态存在——这样它里面的 /* 或引号
      // 不会开启注释、不会扰乱后续状态，而那才是它必须被识别的理由。
      // 代价是字符串里恰好写着一条 import 会误报，那是安全的方向。
      void start;
      prev = quote;
    } else if (c === "/" && isRegexStart(prev)) {
      const start = i;
      i++;
      let inClass = false;
      while (i < n && (inClass || src[i] !== "/")) {
        if (src[i] === "\\") i++;
        else if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        i++;
      }
      i++;
      blank(start, i);
      prev = "/";
    } else {
      if (!/\s/.test(c)) prev = c;
      i++;
    }
  }
  return out.join("");
}

/** `/` 跟在这些字符后面时开始一个正则字面量，否则是除号。 */
function isRegexStart(prev) {
  return prev === "" || "(,=:[!&|?{};+-*%~^<>".includes(prev);
}

const root = process.argv[2] ?? "src/output/dto";
const Q = "[\"'`]";
for (const file of sourceFiles(root)) {
  const raw = readFileSync(file, "utf8");
  let stripped;
  try {
    stripped = stripTypeScriptTypes(raw, { mode: "strip" });
  } catch {
    console.log(`${file}:1: could not parse; ARCH-020 cannot be checked`);
    continue;
  }
  const code = blankNonCode(stripped);
  const lineOf = (idx) => code.slice(0, idx).split("\n").length;

  // 剥离之后任何指向 domain/ 的 import / re-export 都是值导入。
  // 不锚定行首：同一行上的第二条也要抓到。
  for (const m of code.matchAll(new RegExp(`\\b(?:import|export)\\b[^;]*?\\bfrom\\s*${Q}([^"'\`]+)${Q}`, "g"))) {
    if (m[1].includes("domain/")) console.log(`${file}:${lineOf(m.index)}: runtime import of ${m[1]} survives type stripping`);
  }
  // 只为副作用的裸 import 同样是运行时依赖
  for (const m of code.matchAll(new RegExp(`\\bimport\\s*${Q}([^"'\`]+)${Q}`, "g"))) {
    if (m[1].includes("domain/")) console.log(`${file}:${lineOf(m.index)}: side-effect import of ${m[1]}`);
  }
  // 动态 import() 无法静态判定只取类型，一律视为值导入
  for (const m of code.matchAll(new RegExp(`\\bimport\\s*\\(\\s*${Q}([^"'\`]*domain\\/[^"'\`]*)${Q}`, "g"))) {
    console.log(`${file}:${lineOf(m.index)}: dynamic import of ${m[1]}`);
  }
}
