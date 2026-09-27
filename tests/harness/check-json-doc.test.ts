import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

/**
 * ARCH-028 检查器的正反例（F27）。检查器的价值全在「该响的时候响、不该响的时候不响」：
 * 文档与类型一致时安静，字段、类型、可选性、缺小节、引用了没小节的类型时各自说出是哪一节。
 */
const DTO = `export type AReport = { id: string; n?: number; kind: "x" | "y"; items: BItem[] };
export type BItem = { name: string };
export type Internal = { secret: string };
`;
const DOC = `# t

### \`AReport\`

| Field | Type | Meaning |
|---|---|---|
| \`id\` | \`string\` | |
| \`n?\` | \`number\` | |
| \`kind\` | \`"x" \\| "y"\` | |
| \`items\` | \`BItem[]\` | |

### \`BItem\`

\`\`\`ts
type BItem = { name: string };
\`\`\`
`;
function run(doc: string, dto = DTO, env: NodeJS.ProcessEnv = process.env, extra: Record<string, string> = {}): string[] {
  const root = mkdtempSync(join(tmpdir(), "todopi-arch028-"));
  // 与本仓库一样是 ES 模块（没有它 tsc 按 CommonJS 判，dto 里的 export const 会报错）
  const files: Record<string, string> = { "docs/json.md": doc, "src/output/dto/a.ts": dto, "package.json": '{ "type": "module" }\n', ...extra };
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), body);
  }
  return execFileSync(process.execPath, ["--no-warnings", "tools/check-json-doc.mjs", root], { encoding: "utf8", env })
    .split("\n").filter((l) => l.trim() !== "");
}
/** 正例不导出 Internal；反例（DTO 原样）用它验证「dto 里没写进文档的导出」会被报出来 */
const DTO_OK = DTO.replace("export type Internal", "type Internal");

test("一致：没有输出", () => {
  assert.deepEqual(run(DOC, DTO_OK), []);
});

test("字段类型、可选性、字面量联合不同：点名那一节", () => {
  for (const bad of [
    DOC.replace("| `id` | `string` |", "| `id` | `number` |"),
    DOC.replace("| `n?` |", "| `n` |"),
    DOC.replace('`"x" \\| "y"`', '`"x"`'),
    DOC.replace("| `items` | `BItem[]` | |\n", ""),
    DOC.replace("| `items` | `BItem[]` | |\n", "| `items` | `BItem[]` | |\n| `extra` | `string` | |\n"),
  ]) {
    const out = run(bad, DTO_OK);
    assert.equal(out.length, 1, out.join("\n"));
    assert.match(out[0]!, /AReport does not match the type in src\/output\/dto\/a\.ts/);
  }
  const out = run(DOC.replace("type BItem = { name: string };", "type BItem = { name: number };"), DTO_OK);
  assert.match(out.join("\n"), /BItem does not match/);
});

test("dto 的导出类型没有小节、文档引用了没有小节的类型、文档里的类型源码里没有：各报一条", () => {
  assert.match(run(DOC).join("\n"), /Internal \(src\/output\/dto\/a\.ts\) is part of the --json output but has no section/);
  const noB = DOC.slice(0, DOC.indexOf("### `BItem`"));
  assert.match(run(noB, DTO_OK).join("\n"), /AReport refers to BItem, which has no section/);
  assert.match(run(`${DOC}\n### \`Ghost\`\n\n\`\`\`ts\ntype Ghost = string;\n\`\`\`\n`, DTO_OK).join("\n"), /Ghost is not an exported type/);
});

test("小节既没有表也没有 ts 块、ts 块不是 `type Name = …;`：报出来", () => {
  assert.match(run(DOC.replace(/```ts\ntype BItem = \{ name: string \};\n```/, "prose only"), DTO_OK).join("\n"), /BItem has neither/);
  assert.match(run(DOC.replace("type BItem = { name: string };", "type Other = { name: string };"), DTO_OK).join("\n"), /must be exactly `type BItem = …;`/);
});

test("多行的 ts 块之后，后面小节的错误仍报在后面那一节（行号不漂）", () => {
  const doc = DOC.replace("type BItem = { name: string };", "type BItem = {\n  name: string;\n};")
    + "\n### `CItem`\n\n| Field | Type | Meaning |\n|---|---|---|\n| `v` | `string` | |\n";
  const out = run(doc, `${DTO_OK}export type CItem = { v: number };\n`);
  assert.deepEqual(out.map((l) => l.replace(/^docs\/json\.md:\d+: /, "")), ["CItem does not match the type in src/output/dto/a.ts (field, type or optionality)"]);
});

test("tsc 跑不起来：说出来，不安静地通过（那是假绿）", () => {
  const out = run(DOC, DTO_OK, { ...process.env, CHECK_JSON_DOC_TSC: "/nonexistent/tsc" });
  assert.match(out.join("\n"), /ENOENT/);
  assert.ok(out.length > 0);
});

test("元组与数组不能互相冒充；readonly 也算不同", () => {
  const dto = (t: string) => `export type AReport = { pair: ${t} };\n`;
  const doc = (t: string) => `### \`AReport\`\n\n| Field | Type | Meaning |\n|---|---|---|\n| \`pair\` | \`${t}\` | |\n`;
  assert.deepEqual(run(doc("[string, string]"), dto("[string, string]")), []);
  assert.deepEqual(run(doc("string[]"), dto("string[]")), []);
  for (const [d, s] of [["string[]", "[string, string]"], ["[string, string]", "string[]"], ["[string]", "[string, string]"],
    ["[number, string]", "[string, number]"], ["readonly string[]", "string[]"]]) {
    assert.match(run(doc(d!), dto(s!)).join("\n"), /AReport does not match/, `${d} vs ${s}`);
  }
});

test("交集与写成一个对象的同一形状相等（数组元素里的交集也是）；差一个字段仍然不等", () => {
  const dto = "export type Ref = { id: string };\nexport type AReport = { items: (Ref & { n: number })[] } & { ok: boolean };\n";
  const doc = (items: string) => "### `Ref`\n\n| Field | Type | Meaning |\n|---|---|---|\n| `id` | `string` | |\n\n"
    + `### \`AReport\`\n\n| Field | Type | Meaning |\n|---|---|---|\n| \`items\` | \`${items}\` | |\n| \`ok\` | \`boolean\` | |\n`;
  assert.deepEqual(run(doc("{ id: string; n: number }[]"), dto), []);
  assert.deepEqual(run(doc("(Ref & { n: number })[]"), dto), []);
  assert.match(run(doc("{ id: string }[]"), dto).join("\n"), /AReport does not match/);
});

test("interface、declare、导出列表与重导出也算导出：没写进文档照样报；写了就照样核对", () => {
  const empty = "# t\n";
  for (const dto of [
    "export interface NewReport { id: string }\n",
    "export declare type NewReport = { id: string };\n",
    "type NewReport = { id: string };\nexport { NewReport };\n",
    "type Inner = { id: string };\nexport type { Inner as NewReport };\n",
    "type NewReport = { id: string };\nexport { type NewReport };\n",
  ]) {
    assert.match(run(empty, dto).join("\n"), /NewReport \(src\/output\/dto\/a\.ts\) is part of the --json output but has no section/, dto);
  }
  const doc = (t: string) => `### \`NewReport\`\n\n| Field | Type | Meaning |\n|---|---|---|\n| \`id\` | \`${t}\` | |\n`;
  assert.deepEqual(run(doc("string"), "export interface NewReport { id: string }\n"), []);
  assert.match(run(doc("number"), "export interface NewReport { id: string }\n").join("\n"), /NewReport does not match/);
});

test("失败关闭：认不得的导出形式直接报错（注释、缩进、default、namespace、星号、class、enum、export =）", () => {
  for (const dto of [
    'export * from "./b.ts";\n', 'export type * from "./b.ts";\n', 'export * as Ns from "./b.ts";\n', 'export type * as Ns from "./b.ts";\n',
    'export /*c*/ * from "./b.ts";\n',
    "export default interface NewReport { id: string }\n",
    "export namespace Models {\n  export type NewReport = { id: string };\n}\n",
    "export class NewReport { id = \"\" }\n",
    "export enum Kind { A }\n",
    "type NewReport = { id: string };\nexport = NewReport;\n",
  ]) {
    assert.match(run(DOC, `${DTO_OK}${dto}`).join("\n"), /unsupported export form/, dto);
  }
});

test("注释、行首空白、导出列表里的注释都认得：照样要求有小节", () => {
  for (const dto of [
    "export /*c*/ interface NewReport { id: string }\n",
    "export type /*c*/ NewReport = { id: string };\n",
    " export type NewReport = { id: string };\n",
    "  export interface NewReport extends Base { id: string }\ninterface Base { x: number }\n",
    "type NewReport = { id: string };\nexport { /*c*/ NewReport };\n",
    "type NewReport = { id: string };\nexport type { /*c*/ NewReport };\n",
    "// export type Hidden = string;\ntype NewReport = { id: string };\nexport {\n  NewReport, // trailing\n};\n",
  ]) {
    const out = run("# t\n", dto).join("\n");
    assert.match(out, /NewReport \(src\/output\/dto\/a\.ts\) is part of the --json output but has no section/, dto);
    assert.doesNotMatch(out, /Hidden|unsupported/, dto);
  }
  // 正则字面量里的引号不会把后面的导出吞掉（Codex 五轮：`/"/` 曾让扫描器把文件剩下的部分当成字符串）
  assert.match(run("# t\n", 'export const quoted = /"/;\nexport type NewReport = { id: string };\n').join("\n"), /NewReport .* has no section/);
  assert.deepEqual(run(DOC, `${DTO_OK}export const re = /export type Q = 1/;\n`), []);
  // 注释与字符串里的 export、名叫 export 的属性不是导出
  assert.deepEqual(run(DOC, `${DTO_OK}// export type X = 1;\nconst s = "export type Y = 1";\nconst t = "q\\\" export type Z = { a: 1 }; \\\"";\ntype P = { export: string };\n`), []);
});

test("子目录里的 dto 也查（只看一层时它绕过了检查）", () => {
  const out = run(DOC, DTO_OK, process.env, { "src/output/dto/nested/deeper/b.ts": "export type NewReport = { id: string };\n" });
  assert.match(out.join("\n"), /NewReport \(src\/output\/dto\/nested\/deeper\/b\.ts\) is part of the --json output but has no section/);
  const bad = run(DOC, DTO_OK, process.env, { "src/output/dto/nested/b.ts": "export default interface D { id: string }\n" });
  assert.match(bad.join("\n"), /src\/output\/dto\/nested\/b\.ts: unsupported export form/);
});

test("同名类型从两个文件导出：报错（只核对一个定义时，另一个绕过了检查）", () => {
  const out = run(DOC, DTO_OK, process.env, { "src/output/dto/b.ts": "export type AReport = { id: number };\n" });
  assert.match(out.join("\n"), /AReport is exported by src\/output\/dto\/a\.ts and src\/output\/dto\/b\.ts/);
  const fwd = run(DOC, DTO_OK, process.env, { "src/output/dto/b.ts": 'export type { AReport } from "./a.ts";\n' });
  assert.match(fwd.join("\n"), /AReport is exported by/);
  // 写进文档的名字：domain 里两处导出也报
  const dom = run(DOC, DTO_OK, process.env, { "src/domain/x.ts": "export type BItem = { name: string };\n" });
  assert.match(dom.join("\n"), /BItem is exported by src\/domain\/x\.ts and src\/output\/dto\/a\.ts|BItem is exported by src\/output\/dto\/a\.ts and src\/domain\/x\.ts/);
  // 写进文档、但只在 domain 里的两处导出（没有 dto 参与）：也报
  const onlyDomain = run(`${DOC}\n### \`Dom\`\n\n\`\`\`ts\ntype Dom = string;\n\`\`\`\n`, DTO_OK, process.env,
    { "src/domain/x.ts": "export type Dom = string;\n", "src/domain/y.ts": 'export type { Dom } from "./x.ts";\n' });
  assert.match(onlyDomain.join("\n"), /Dom is exported by src\/domain\/x\.ts and src\/domain\/y\.ts/);
  // 与 --json 无关的 domain 内部转发：不管
  assert.deepEqual(run(DOC, DTO_OK, process.env, { "src/domain/x.ts": "export type L = { a: 1 };\n", "src/domain/y.ts": 'export type { L } from "./x.ts";\n' }), []);
});
