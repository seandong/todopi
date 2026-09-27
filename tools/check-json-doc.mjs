#!/usr/bin/env node
// tools/check-json-doc.mjs —— ARCH-028：docs/json.md 与 --json 真正序列化的类型一致（FR-Q3，F27）。
//
// 用法：node tools/check-json-doc.mjs [root]   （root 默认当前目录；测试用临时目录）
// 一切一致时什么都不输出；否则每个问题一行（harness 的 expect: empty）。
//
// 怎么查：文档里每个 `### \`Name\`` 小节要么是一张 Field / Type 表，要么是一个 ```ts 代码块（`type Name = …;`）。把它们翻成
// TypeScript，与源码里同名的导出类型逐个做**精确相等**的断言，交给 tsc 判——字段、类型、可选性差一点都通不过。为什么不从类型生成
// 文档：项目用的 TypeScript 7 没有 JS 的编译器 API，而手写的说明（每个字段是什么意思）本来就生成不出来。
//
// 另外两条：src/output/dto/ 里每个导出类型都要有小节（内部投影除外，见 INTERNAL）；小节里提到的类型名都要有自己的小节。

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] ?? ".");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = join(root, "docs", "json.md");
const SOURCES = ["src/output/dto", "src/domain"];

/** 不进 --json 的 DTO 导出：commands/ 与 dto 之间的投影（带着内部的 TaskFile）、只给 web 页面用的看板数据，以及 LsReport（ls --json 只印它的 tasks 数组，total 与 invalid 走文本与 stderr）。 */
const INTERNAL = new Set(["TaskProjection", "ShowProjection", "TreeNode", "BoardDto", "BoardTaskDto", "LsReport"]);
/** 类型表达式里可以出现、但不需要文档小节的名字 */
const BUILTIN = new Set(["Record", "Array"]);

const problems = [];
const say = (m) => problems.push(m);

if (!existsSync(DOC)) {
  console.log(`docs/json.md is missing: the --json contract (FR-Q3) has no document`);
  process.exit(0);
}

// ---- 解析文档 ----

/** 表格单元格：去掉外层反引号，`\|` 还原成 `|`。 */
const cell = (c) => c.trim().replace(/^`(.*)`$/, "$1").replace(/\\\|/g, "|");
/** 按未转义的 `|` 切一行表格。 */
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/);

const lines = readFileSync(DOC, "utf8").split("\n");
/** name → { expr: TS 类型表达式, line: 小节标题所在行 } */
const documented = new Map();
for (let i = 0; i < lines.length; i++) {
  const h = /^### `([A-Za-z][A-Za-z0-9]*)`\s*$/.exec(lines[i]);
  if (h === null) continue;
  const name = h[1];
  let end = i + 1;
  while (end < lines.length && !/^#{1,3} /.test(lines[end])) end++;
  const body = lines.slice(i + 1, end);
  const fence = body.findIndex((l) => l.trim() === "```ts");
  if (fence >= 0) {
    const close = body.findIndex((l, k) => k > fence && l.trim() === "```");
    const code = body.slice(fence + 1, close < 0 ? undefined : close).join("\n");
    const m = new RegExp(`^\\s*type\\s+${name}\\s*=([\\s\\S]*);\\s*$`).exec(code);
    if (m === null) say(`docs/json.md:${i + 1}: the ts block under ${name} must be exactly \`type ${name} = …;\``);
    else documented.set(name, { expr: m[1].trim(), line: i + 1 });
    continue;
  }
  const head = body.findIndex((l) => /^\|\s*Field\s*\|\s*Type\s*\|/.test(l));
  if (head < 0) { say(`docs/json.md:${i + 1}: ${name} has neither a Field / Type table nor a ts block`); continue; }
  const bases = [];
  const fields = [];
  for (let k = head + 2; k < body.length && body[k].trim().startsWith("|"); k++) {
    const [f, t] = cells(body[k]);
    const base = /^\(all of `([A-Za-z][A-Za-z0-9]*)`\)$/.exec(f.trim());
    if (base !== null) { bases.push(base[1]); continue; }
    const field = cell(f);
    const type = cell(t ?? "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*\??$/.test(field) || type === "") {
      say(`docs/json.md:${i + 2 + k}: ${name}: cannot read the row ${JSON.stringify(body[k].trim())}`);
      continue;
    }
    fields.push(`${field}: ${type};`);
  }
  documented.set(name, { expr: [...bases, `{ ${fields.join(" ")} }`].join(" & "), line: i + 1 });
}

// ---- 源码里的导出类型 ----

/** name → 源文件（相对 root） */
const exported = new Map();
for (const dir of SOURCES) {
  const abs = join(root, dir);
  if (!existsSync(abs)) continue;
  for (const f of readdirSync(abs).filter((x) => x.endsWith(".ts")).sort()) {
    const text = readFileSync(join(abs, f), "utf8");
    // 声明（type / interface，可带 declare）与导出列表（`export { A, type B as C }`、`export type { D }`，含 `from "…"` 的重导出）都算——
    // 只认 `export type Name` 时，一个 `export interface` 的 DTO 就绕过了「每个导出都要有小节」（Codex 评审）
    const names = [
      ...[...text.matchAll(/^export\s+(?:declare\s+)?(?:type|interface)\s+([A-Za-z][A-Za-z0-9]*)\b/gm)].map((m) => m[1]),
      ...[...text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)].flatMap((m) => m[1].split(",")
        .map((x) => x.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim()).filter((x) => /^[A-Za-z][A-Za-z0-9]*$/.test(x))),
    ];
    for (const n of names) if (!exported.has(n)) exported.set(n, `${dir}/${f}`);
    // `export * from` 导出了什么这里看不见：dto 里不许用，逐个写出来
    if (dir === "src/output/dto" && /^export\s+\*/m.test(text)) say(`${dir}/${f}: \`export *\` hides which types are part of --json; export them by name`);
  }
}

for (const [name, file] of exported) {
  if (file.startsWith("src/output/dto/") && !INTERNAL.has(name) && !documented.has(name)) {
    say(`docs/json.md: ${name} (${file}) is part of the --json output but has no section`);
  }
}
for (const [name, d] of documented) {
  if (!exported.has(name)) say(`docs/json.md:${d.line}: ${name} is not an exported type in ${SOURCES.join(" or ")}`);
  const names = d.expr.replace(/"[^"]*"/g, "").match(/\b[A-Z][A-Za-z0-9]*\b/g) ?? [];
  for (const ref of new Set(names)) {
    if (!BUILTIN.has(ref) && !documented.has(ref)) say(`docs/json.md:${d.line}: ${name} refers to ${ref}, which has no section`);
  }
}

// ---- 交给 tsc：每个小节与同名导出类型精确相等 ----

const checkable = [...documented].filter(([name]) => exported.has(name));
if (checkable.length > 0) {
  const work = join(root, ".harness-results", "json-doc");
  mkdirSync(work, { recursive: true });
  const imports = [...new Set(checkable.map(([n]) => exported.get(n)))].map((file) => {
    const names = checkable.filter(([n]) => exported.get(n) === file).map(([n]) => n);
    return `import type { ${names.join(", ")} } from "${relative(work, join(root, file))}";`;
  });
  const lineOf = new Map();
  const out = [
    ...imports,
    // 交集与映射类型展平之后再比，「A & B」与写成一个对象的同一形状才算相等；联合逐支展平。对类型参数的同态映射保留数组与元组
    // 本身（长度、位置、readonly），所以不另写数组分支——那个分支曾把 [string, string] 折成 string[]，元组与数组互相冒充（Codex 评审）
    "type Flat<T> = T extends object ? { [K in keyof T]: Flat<T[K]> } : T;",
    "type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;",
    "type Expect<T extends true> = T;",
  ];
  for (const [name, d] of checkable) {
    lineOf.set(out.length + 1, { name, line: d.line });
    // 文档里的名字指的是同名的真实类型，所以文档类型与源码类型用同一套名字解析
    // 一个断言占一行（多行的 ts 块并成一行），tsc 报的行号才对得回是哪个小节
    out.push(`export type _${name} = Expect<Equal<Flat<${name}>, Flat<${d.expr.replace(/\s+/g, " ")}>>>;`);
  }
  const file = join(work, "check.ts");
  writeFileSync(file, `${out.join("\n")}\n`);
  writeFileSync(join(work, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2023", module: "nodenext", moduleResolution: "nodenext", lib: ["ES2023"], types: ["node"],
      typeRoots: [join(repo, "node_modules", "@types")], strict: true, noEmit: true, allowImportingTsExtensions: true,
      verbatimModuleSyntax: true, skipLibCheck: true,
    },
    files: ["check.ts"],
  }, null, 2));
  // CHECK_JSON_DOC_TSC 只给测试用：验证 tsc 跑不起来时检查器不会安静地通过
  const tsc = process.env.CHECK_JSON_DOC_TSC ?? join(repo, "node_modules", ".bin", "tsc");
  let result = "";
  let failed = false;
  try {
    execFileSync(tsc, ["-p", join(work, "tsconfig.json")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    failed = true;
    result = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    if (result.trim() === "") result = String(err);
  }
  // tsc 没跑起来（找不到、崩了）或报了别处的错：原样说出来。**失败却一条也对不回小节时绝不安静**——那是假绿
  let attributed = 0;
  const other = [];
  for (const l of result.split("\n").filter((x) => x.trim() !== "")) {
    const m = /check\.ts\((\d+),\d+\)/.exec(l);
    const at = m === null ? undefined : lineOf.get(Number(m[1]));
    if (at !== undefined) {
      attributed++;
      say(`docs/json.md:${at.line}: ${at.name} does not match the type in ${exported.get(at.name)} (field, type or optionality)`);
    } else other.push(l.trim());
  }
  if (failed && attributed === 0) for (const l of other.length > 0 ? other : ["tsc failed with no output"]) say(`tsc: ${l}`);
  else for (const l of other.filter((x) => /error/i.test(x))) say(`tsc: ${l}`);
  rmSync(work, { recursive: true, force: true });
}

for (const p of [...new Set(problems)]) console.log(p);
