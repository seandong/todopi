import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertProtocol } from "../../src/format/agents-md.ts";
import { PROTOCOL_BEGIN, PROTOCOL_END, PROTOCOL_TEXT, protocolSection } from "../../src/protocol.ts";

const file = () => join(mkdtempSync(join(tmpdir(), "todopi-agents-")), "AGENTS.md");
const count = (s: string, sub: string) => s.split(sub).length - 1;

test("文件不存在时创建", () => {
  const p = file();
  assert.equal(upsertProtocol(p), "created");
  assert.ok(readFileSync(p, "utf8").includes(PROTOCOL_TEXT));
});

test("已有文件时追加，原有内容一字不动", () => {
  const p = file();
  const before = "# My Manual\n\n重要的项目约定，不能被动。\n";
  writeFileSync(p, before);
  assert.equal(upsertProtocol(p), "appended");
  const after = readFileSync(p, "utf8");
  assert.ok(after.startsWith(before), "原有内容必须原样保留在开头");
  assert.ok(after.includes(PROTOCOL_TEXT));
});

test("重复运行不产生第二份段落（FR-Q5 幂等）", () => {
  const p = file();
  upsertProtocol(p);
  const second = upsertProtocol(p);
  assert.equal(second, "unchanged");
  assert.equal(count(readFileSync(p, "utf8"), PROTOCOL_BEGIN), 1);
});

test("段落内容过期时原地替换，段落外的内容逐字节不动", () => {
  const p = file();
  const head = "# Head\n\n";
  const tail = "\n# Tail\n\n最后一段。\n";
  writeFileSync(p, `${head}${PROTOCOL_BEGIN}\n\nOLD PROTOCOL\n${PROTOCOL_END}\n${tail}`);
  assert.equal(upsertProtocol(p), "replaced");
  const after = readFileSync(p, "utf8");

  // 逐字节断言而不是只看首尾：只检查 startsWith/endsWith 的话，段落两侧多一个或
  // 少一个换行符都测不出来——变异测试证实过这一点。
  assert.equal(after, head + protocolSection() + tail);
  assert.ok(!after.includes("OLD PROTOCOL"));
  assert.equal(count(after, PROTOCOL_BEGIN), 1);
});

test("替换是可重入的：替换之后再跑一次得到 unchanged 且内容不变", () => {
  const p = file();
  const head = "# Head\n\n";
  const tail = "\n# Tail\n";
  writeFileSync(p, `${head}${PROTOCOL_BEGIN}\n\nOLD\n${PROTOCOL_END}\n${tail}`);
  upsertProtocol(p);
  const once = readFileSync(p, "utf8");
  assert.equal(upsertProtocol(p), "unchanged");
  assert.equal(readFileSync(p, "utf8"), once, "第二次运行不得改动任何字节");
});

test("只有起始标记而没有结束标记时拒绝，不猜边界", () => {
  const p = file();
  writeFileSync(p, `# Head\n\n${PROTOCOL_BEGIN}\n\n半个段落\n`);
  assert.throws(() => upsertProtocol(p), /标记/);
});

test("追加时与原有内容之间留空行，不粘连", () => {
  const p = file();
  writeFileSync(p, "# My Manual\n最后一行没有换行符");
  upsertProtocol(p);
  const after = readFileSync(p, "utf8");
  assert.match(after, /最后一行没有换行符\n\n<!-- todopi:protocol:begin -->/);
});
