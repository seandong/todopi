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
  assert.throws(() => upsertProtocol(p), /end marker/);
});

test.describe("追加时原文一个字节都不动，只补足分隔符", () => {
  // 段落之外的内容必须逐字节保留。早先的实现先削平所有尾部换行再补两个，
  // 一个以三个以上 LF 结尾的文件会被静默改写——而那也是「段落之外的内容」。
  const cases: Array<[string, string]> = [
    ["没有尾部换行", "# My Manual\n最后一行没有换行符"],
    ["一个 LF", "# My Manual\n"],
    ["两个 LF", "# My Manual\n\n"],
    ["三个 LF", "# My Manual\n\n\n"],
    ["五个 LF", "# My Manual\n\n\n\n\n"],
    ["空文件", ""],
  ];
  for (const [name, before] of cases) {
    test(name, () => {
      const p = file();
      writeFileSync(p, before);
      assert.equal(upsertProtocol(p), "appended");
      const after = readFileSync(p, "utf8");

      assert.ok(after.startsWith(before), `原文必须逐字节保留，${name} 被改写了`);
      assert.ok(after.endsWith(protocolSection()));
      // 段落之前恰好一个空行：既不粘连，也不因原文本来就有换行而堆叠
      const between = after.slice(before.length, after.length - protocolSection().length);
      const totalNewlines = (/\n*$/.exec(before)?.[0].length ?? 0) + between.length;
      assert.equal(totalNewlines, Math.max(2, /\n*$/.exec(before)?.[0].length ?? 0),
        `${name}：分隔符应补足到至少两个换行，且不削减原有的`);
    });
  }
});
