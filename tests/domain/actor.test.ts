import { test } from "node:test";
import assert from "node:assert";
import { isMine, normalizeActor, resolveActor } from "../../src/domain/actor.ts";
import { ACTOR_RE } from "../../src/domain/types.ts";

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

// ---- spec §5.4 的规范化 ----

test("规范化的步骤是**有序**的：先换空白再删非法字符", () => {
  // 顺序反了的话 "Sean Dong" 会变成 seandong（空格本身就在待删字符集里），
  // 而不是 sean-dong。spec §5.4 把顺序写死了，这不是实现细节。
  assert.equal(normalizeActor("Sean Dong"), "sean-dong");
});

test("连续空白算作一段", () => {
  assert.equal(normalizeActor("Sean   Dong"), "sean-dong");
  assert.equal(normalizeActor("Sean\t\nDong"), "sean-dong");
});

test("小写化", () => {
  assert.equal(normalizeActor("SEAN"), "sean");
  assert.equal(normalizeActor("Claude-Code@MBP"), "claude-code@mbp");
});

test("[a-z0-9_.@+-] 之外的字符被删除", () => {
  assert.equal(normalizeActor("sean(dong)!"), "seandong");
  assert.equal(normalizeActor("董正轩"), null, "全是被删字符 → 结果为空 → 拒绝");
  assert.equal(normalizeActor("sean.dong+work@mbp_1-2"), "sean.dong+work@mbp_1-2", "允许的字符都留着");
});

test("截断到 64 个字符", () => {
  assert.equal(normalizeActor("a".repeat(100))?.length, 64);
});

test("结果为空则拒绝（返回 null）", () => {
  for (const v of ["", "!!!", "()", "中文"]) assert.equal(normalizeActor(v), null, JSON.stringify(v));
});

test("纯空白按规格字面得到 \"-\"，不额外收紧", () => {
  // spec §5.4 的拒绝条件只有「结果为空」，而空白换成 - 之后结果是 "-"，不为空。
  // 我们不私自收紧：第三方按规格实现会得到 "-"，我们若拒绝就产生互操作分歧，
  // 而那属于改语义、要走版本与迁移流程的事。
  assert.equal(normalizeActor("   "), "-");
  assert.equal(resolveActor({ gitName: "   ", host: "mbp" }), "-");
});

test("规范化的结果总是合法 actor", () => {
  for (const v of ["Sean Dong", "SEAN", "a".repeat(100), "sean(dong)", "Claude Code@MBP"]) {
    const n = normalizeActor(v);
    if (n !== null) assert.ok(ACTOR_RE.test(n), `${JSON.stringify(v)} → ${JSON.stringify(n)} 不合法`);
  }
});

// ---- FR-C4 的解析链 ----

const HOST = "mbp";

test("解析链的优先级：--as > TODOPI_ACTOR > git config user.name", () => {
  assert.equal(resolveActor({ explicit: "a", env: "b", gitName: "c", host: HOST }), "a");
  assert.equal(resolveActor({ env: "b", gitName: "c", host: HOST }), "b");
  assert.equal(resolveActor({ gitName: "c", host: HOST }), "c");
});

test("git config 的值经 §5.4 规范化 —— 这类值常含空格", () => {
  assert.equal(resolveActor({ gitName: "Sean Dong", host: HOST }), "sean-dong");
});

test("--as 与 TODOPI_ACTOR **不**规范化，非法就报错", () => {
  // 这两个是人手输入的。悄悄改掉它会让人纳闷自己的过滤器为什么不匹配；
  // 报错则当场说清楚。只有从 git config 取来的值才是「外部来源」，需要规范化。
  assert.equal(resolveActor({ explicit: "Sean Dong", host: HOST, onInvalid: () => "ERR" }), "ERR");
  assert.equal(resolveActor({ env: "has space", host: HOST, onInvalid: () => "ERR" }), "ERR");
  assert.equal(resolveActor({ explicit: "SEAN", host: HOST }), "SEAN", "合法就原样用，不小写化");
});

test("全都没有时回退到 unknown@<host>", () => {
  // 带上 host 而不是光秃秃的 unknown：@host 的宽松匹配因此仍然成立，
  // 而 unknown 这个前缀一眼就看得出是占位符。
  assert.equal(resolveActor({ host: HOST }), "unknown@mbp");
  assert.equal(resolveActor({ gitName: "!!!", host: HOST }), "unknown@mbp", "规范化后为空也走回退");
});

test("空字符串的 env 与 gitName 当作没有", () => {
  assert.equal(resolveActor({ env: "", gitName: "c", host: HOST }), "c");
  assert.equal(resolveActor({ env: "", gitName: "", host: HOST }), "unknown@mbp");
});
