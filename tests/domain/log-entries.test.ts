import { test } from "node:test";
import assert from "node:assert";
import { logEntries, logLines } from "../../src/domain/validate.ts";

const body = (...log: string[]): string => ["## Description", "", "x", "", "## Log", "", ...log, ""].join("\n");

test("续行并进上一条 —— forced done 带 3 行尾部是 1 条，不是 4 条", () => {
  // F07 的 forced done 会把 verify 输出最后 512 字节作为续行写进来。
  // logLines 只取 `- ` 开头的行，续行被丢掉；show 要的是完整的那一条。
  const b = body(
    "- 2026-09-24T00:00:00Z me@h created",
    "- 2026-09-24T00:01:00Z me@h done verify=fail commit=abc1234 dirty=false forced=true: flaky",
    "  FAIL one",
    "  FAIL two",
    "  - looks like an item but is indented",
  );
  const entries = logEntries(b);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[1]!.continuation, ["FAIL one", "FAIL two", "- looks like an item but is indented"]);
  assert.match(entries[1]!.head, /^- 2026-09-24T00:01:00Z .* forced=true: flaky$/);
});

test("续行只去掉两格缩进，更深的缩进保留", () => {
  const e = logEntries(body("- 2026-09-24T00:00:00Z me@h note: a", "    deeper"));
  assert.deepEqual(e[0]!.continuation, ["  deeper"]);
});

test("空行结束续行；Log 段之后的小节不算", () => {
  const b = [
    "## Log", "",
    "- 2026-09-24T00:00:00Z me@h note: a",
    "  cont",
    "",
    "  orphan after blank",
    "- 2026-09-24T00:01:00Z me@h note: b",
    "",
    "## Notes",
    "- not a log line",
  ].join("\n");
  const e = logEntries(b);
  assert.equal(e.length, 2);
  assert.deepEqual(e[0]!.continuation, ["cont"]);
  assert.deepEqual(e[1]!.continuation, []);
});

test("与 logLines 条数一致 —— 两者只在续行上有区别", () => {
  const b = body(
    "- 2026-09-24T00:00:00Z me@h created",
    "  c1",
    "- 2026-09-24T00:01:00Z me@h claimed",
  );
  assert.deepEqual(logEntries(b).map((e) => e.head), logLines(b));
});

test("没有 Log 段 → 空数组", () => {
  assert.deepEqual(logEntries("## Description\n\nhi\n"), []);
});
