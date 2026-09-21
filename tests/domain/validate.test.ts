import { test } from "node:test";
import assert from "node:assert";
import { validateFile } from "../../src/domain/validate.ts";
import type { TaskFile } from "../../src/domain/types.ts";

function task(fm: Record<string, unknown>, extra: Partial<TaskFile> = {}): TaskFile {
  return {
    path: "tasks/tp-a1b2c3.md",
    idFromFilename: "tp-a1b2c3",
    frontmatter: {
      id: "tp-a1b2c3", title: "T", status: "open",
      created: "2026-09-14T09:00:00Z", updated: "2026-09-14T09:00:00Z",
      ...fm,
    },
    body: "", raw: "", ...extra,
  };
}
const rules = (t: TaskFile) => validateFile(t).map((f) => f.rule);

test("最小合法任务没有 finding", () => {
  assert.deepEqual(validateFile(task({})), []);
});

test("不变量 1：id 与文件名不符", () => {
  assert.ok(rules(task({ id: "tp-999999" })).includes("invariant-1"));
});

test("不变量 1：解析失败报 envelope", () => {
  const t = task({}, { parseError: "boom", frontmatter: {} });
  assert.ok(rules(t).includes("envelope"));
});

test("不变量 2：open 带 resolution", () => {
  assert.ok(rules(task({ resolution: "done" })).includes("invariant-2"));
});

test("不变量 2：closed 缺 resolution", () => {
  assert.ok(rules(task({ status: "closed" })).includes("invariant-2"));
});

test("不变量 3：open 带 assignee", () => {
  assert.ok(rules(task({ assignee: "sean" })).includes("invariant-3"));
});

test("不变量 3：in_progress 缺 assignee", () => {
  assert.ok(rules(task({ status: "in_progress" })).includes("invariant-3"));
});

test("不变量 3：closed 可以带 assignee（唯一的例外）", () => {
  const t = task({ status: "closed", resolution: "done", assignee: "sean" });
  assert.deepEqual(rules(t).filter((r) => r === "invariant-3"), []);
});

test("不变量 6：updated 早于 created", () => {
  const t = task({ created: "2026-09-14T10:00:00Z", updated: "2026-09-14T09:00:00Z" });
  assert.ok(rules(t).includes("invariant-6"));
});

test("不变量 7：行首的冲突标记", () => {
  const t = task({}, { body: "\n## Description\n\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x\n" });
  assert.ok(rules(t).includes("invariant-7"));
});

test("不变量 7：正文中间出现的 ======= 不算（不在行首）", () => {
  const t = task({}, { body: "\n见 a ======= b\n" });
  assert.deepEqual(rules(t).filter((r) => r === "invariant-7"), []);
});

test("不变量 8：assignee 含空格", () => {
  const t = task({ status: "in_progress", assignee: "Sean Zhang" });
  assert.ok(rules(t).includes("invariant-8"));
});

test("Log 行的 actor 含空格 → 报语法错位（空格就是字段分隔符，actor 本身看起来合法）", () => {
  const t = task({}, { body: "\n## Log\n\n- 2026-09-14T09:00:00Z Sean Zhang created\n" });
  const fs = validateFile(t);
  assert.ok(fs.some((f) => f.rule === "field" && /grammar/.test(f.message)), JSON.stringify(fs));
});

test("不变量 8：Log 行的 actor 超长（这种才是 actor 自身可检出的）", () => {
  const long = "a".repeat(65);
  const t = task({}, { body: `\n## Log\n\n- 2026-09-14T09:00:00Z ${long} created\n` });
  assert.ok(rules(t).includes("invariant-8"));
});

test("合法的 Log 行不报错：带 key=value、带文本、带多行续行", () => {
  const body = [
    "", "## Log", "",
    "- 2026-09-14T09:00:00Z sean created from=tp-9f00k2",
    "- 2026-09-14T10:12:00Z claude-code@mbp claimed",
    "- 2026-09-14T10:20:00Z claude-code@mbp note: webauthn-lib 1.x 在 Node 22 上会挂",
    "  续行缩进两格，不是新的一项",
    "- 2026-09-14T10:41:00Z claude-code@mbp check ac=1: 已注册 passkey 的用户能登录",
    "- 2026-09-14T11:02:00Z claude-code@mbp done verify=pass commit=3f2a1c9 dirty=false",
    "",
  ].join("\n");
  assert.deepEqual(validateFile(task({}, { body })), []);
});

test("rank 是数字而非字符串时报错（不带引号的 007 会走到这里）", () => {
  assert.ok(rules(task({ rank: 7 })).length > 0);
});

test("必填字段缺失时报错", () => {
  const t = task({});
  delete t.frontmatter["title"];
  assert.ok(rules(t).length > 0);
});
