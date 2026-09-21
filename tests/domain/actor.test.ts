import { test } from "node:test";
import assert from "node:assert";
import { isMine } from "../../src/domain/actor.ts";

const host = "mbp";

test("assignee 等于已解析的 actor → 是我的", () => {
  assert.equal(isMine("sean", { actor: "sean", host }), true);
});

test("assignee 以 @<本机 host> 结尾 → 是我的（FR-C6 的宽松匹配）", () => {
  // 人在终端看到的应当是自己 agent 做的事——这正是 --mine / prime / handoff
  // 存在的意义。不需要配置，也不需要保存一份 actor 清单。
  assert.equal(isMine("claude-code@mbp", { actor: "sean", host }), true);
  assert.equal(isMine("codex@mbp", { actor: "sean", host }), true);
});

test("没有已解析的 actor 时，仍靠 @host 后缀工作", () => {
  assert.equal(isMine("claude-code@mbp", { host }), true);
  assert.equal(isMine("sean", { host }), false, "裸名在没有 actor 时无从判断");
});

test("别的机器上的 actor 不是我的", () => {
  assert.equal(isMine("claude-code@other", { actor: "sean", host }), false);
});

test("host 是后缀而不是子串 —— 不能把 @notmbp 当成 @mbp", () => {
  assert.equal(isMine("claude-code@notmbp", { actor: "sean", host }), false);
  assert.equal(isMine("claude-code@mbp.local", { actor: "sean", host }), false);
});

test("assignee 恰好等于 @host 也算 —— 边界，但语法上合法", () => {
  assert.equal(isMine("@mbp", { host }), true);
});

test("assignee 缺失或不是字符串 → 不是我的", () => {
  for (const v of [undefined, null, 42, [], {}, ""]) {
    assert.equal(isMine(v, { actor: "sean", host }), false, JSON.stringify(v));
  }
});

test("actor 为空字符串时不参与匹配 —— 否则空 assignee 会被当成我的", () => {
  assert.equal(isMine("", { actor: "", host }), false);
  assert.equal(isMine("someone", { actor: "", host }), false);
});
