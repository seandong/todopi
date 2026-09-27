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
function run(doc: string, dto = DTO, env: NodeJS.ProcessEnv = process.env): string[] {
  const root = mkdtempSync(join(tmpdir(), "todopi-arch028-"));
  const files: Record<string, string> = { "docs/json.md": doc, "src/output/dto/a.ts": dto };
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
  assert.match(out.join("\n"), /^tsc: .*ENOENT/m);
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
