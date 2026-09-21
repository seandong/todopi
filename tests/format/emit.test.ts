import { test } from "node:test";
import assert from "node:assert";
import { emitFrontmatter, emitTask, nextRank } from "../../src/format/emit.ts";
import { splitEnvelope } from "../../src/format/envelope.ts";
import { parseFrontmatter } from "../../src/format/frontmatter.ts";
import { scanCanonical } from "../../src/format/scan.ts";

const roundTrip = (fm: Record<string, unknown>) => {
  const text = emitFrontmatter(fm);
  const scanned = scanCanonical(text);
  assert.notEqual(scanned, null, `发射出的 frontmatter 必须走得通快路径：\n${text}`);
  return scanned;
};

test("键按 spec §5.2 的顺序发射", () => {
  const text = emitFrontmatter({
    updated: "2026-09-14T10:00:00Z", labels: ["auth"], id: "tp-a1b2c3",
    created: "2026-09-14T09:00:00Z", status: "open", title: "T",
  });
  const keys = text.split("\n").filter(Boolean).map((l) => l.slice(0, l.indexOf(":")));
  assert.deepEqual(keys, ["id", "title", "status", "labels", "created", "updated"]);
});

test.describe("对抗样例的写入方向 round-trip 无损", () => {
  const titles: Array<[string, string]> = [
    ["冒号", "feat: add login"],
    ["# 号", "fix #42 in the C# parser"],
    ["形似数字", "1.20"],
    ["YAML 关键字", "null"],
    ["尾随空格", "trailing spaces   "],
    ["双引号与反斜杠", 'He said "yes" then left C:\\path'],
    ["非 ASCII", "支持 passkey 登录 🥔"],
    ["形似 checkbox", "- [ ] not a checkbox"],
    ["YAML 元字符", "@at &anchor *star |pipe >gt %pct {a} [b] ,c"],
  ];
  for (const [name, title] of titles) {
    test(name, () => {
      const got = roundTrip({ id: "tp-a1b2c3", title, status: "open",
        created: "2026-09-14T09:00:00Z", updated: "2026-09-14T09:00:00Z" });
      assert.equal(got!["title"], title);
    });
  }
});

test("前导零的 rank 作为字符串保留", () => {
  const got = roundTrip({ id: "tp-a1b2c3", title: "T", status: "open", rank: "007",
    created: "2026-09-14T09:00:00Z", updated: "2026-09-14T09:00:00Z" });
  assert.equal(got!["rank"], "007");
});

test("列表用 flow 形式且元素加引号；空列表发射为 []", () => {
  const text = emitFrontmatter({ id: "tp-a1b2c3", title: "T", status: "open",
    blocked_by: [], labels: ["auth", "web"],
    created: "2026-09-14T09:00:00Z", updated: "2026-09-14T09:00:00Z" });
  assert.match(text, /^blocked_by: \[\]$/m);
  assert.match(text, /^labels: \["auth", "web"\]$/m);
});

test("undefined 的可选字段不被发射", () => {
  const text = emitFrontmatter({ id: "tp-a1b2c3", title: "T", status: "open",
    parent: undefined, verify: undefined,
    created: "2026-09-14T09:00:00Z", updated: "2026-09-14T09:00:00Z" });
  assert.doesNotMatch(text, /parent|verify/);
});

test("发射的整个任务文件能被 F01 的解析器读回", () => {
  const text = emitTask({
    id: "tp-a1b2c3", title: "feat: add login #42", status: "open", rank: "i0",
    created: "2026-09-14T09:00:00Z", updated: "2026-09-14T09:00:00Z",
    description: "Some description.",
    acceptance: ["first criterion", "second criterion"],
    log: ["2026-09-14T09:00:00Z sean created"],
  });
  const env = splitEnvelope(text);
  assert.ok(env, "必须是合法的信封");
  const parsed = parseFrontmatter(env!.head);
  assert.ok(parsed.ok);
  assert.equal(parsed.ok && parsed.data["title"], "feat: add login #42");
  assert.match(env!.body, /^## Description$/m);
  assert.match(env!.body, /^- \[ \] first criterion$/m);
  assert.match(env!.body, /^## Log$/m);
  assert.match(env!.body, /^- 2026-09-14T09:00:00Z sean created$/m);
});

test("没有可选正文小节时不发射空标题", () => {
  const text = emitTask({ id: "tp-a1b2c3", title: "T", status: "open", rank: "i0",
    created: "2026-09-14T09:00:00Z", updated: "2026-09-14T09:00:00Z", log: ["x"] });
  assert.doesNotMatch(text, /## Description/);
  assert.doesNotMatch(text, /## Acceptance Criteria/);
  assert.match(text, /## Log/);
});

test("nextRank 追加到末尾且字典序单调", () => {
  let last: string | null = null;
  const keys: string[] = [];
  for (let i = 0; i < 6; i++) { last = nextRank(last); keys.push(last); }
  assert.deepEqual(keys, [...keys].sort(), "连续分配的 rank 必须字典序单调");
  for (const k of keys) assert.match(k, /^[0-9a-z]{1,32}$/, "rank 必须匹配 spec §5.2");
});

test("嵌套值被拒绝而不是悄悄写出半个结构（F10 edit 才需要完整 YAML 发射器）", () => {
  assert.throws(
    () => emitFrontmatter({ id: "tp-a1b2c3", external: { linear: { id: "E-1" } } }),
    /nested/i,
  );
});
