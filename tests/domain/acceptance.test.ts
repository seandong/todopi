import { test } from "node:test";
import assert from "node:assert";
import { parseAcceptance, allChecked, sectionLines } from "../../src/domain/acceptance.ts";

const body = [
  "## Description", "", "whatever", "",
  "## Acceptance Criteria", "",
  "- [ ] first",
  "  - [x] nested does not count",
  "- [X] second uppercase",
  "- a bare note, not a criterion",
  "", "## Log", "",
  "- 2026-09-14T09:00:00Z a created",
].join("\n");

test("嵌套项不算标准，也不占编号（spec §5.3.2）", () => {
  // 「Nested list items and non-checkbox lines are not criteria」——不算标准，
  // 自然也不该消耗一个编号。编号错位会让 `check <id> <n>` 勾错行（F09）。
  const cs = parseAcceptance(body);
  assert.deepEqual(cs.map((c) => [c.n, c.text, c.checked]), [
    [1, "first", false],
    [2, "second uppercase", true],
  ]);
});

test("[X] 大写也算勾上", () => {
  assert.equal(parseAcceptance("## Acceptance Criteria\n\n- [X] done\n")[0]?.checked, true);
  assert.equal(parseAcceptance("## Acceptance Criteria\n\n- [x] done\n")[0]?.checked, true);
  assert.equal(parseAcceptance("## Acceptance Criteria\n\n- [ ] not done\n")[0]?.checked, false);
});

test("非复选框行不算标准，也不会让任务变成未满足", () => {
  const cs = parseAcceptance("## Acceptance Criteria\n\n- just a note\nplain paragraph\n");
  assert.equal(cs.length, 0);
  assert.equal(allChecked(cs), true, "一行普通文字不该把任务判成未就绪");
});

test("空的或没有这个小节算满足（spec §5.3.2 末句）", () => {
  assert.equal(allChecked(parseAcceptance("")), true);
  assert.equal(allChecked(parseAcceptance("## Acceptance Criteria\n\n")), true);
  assert.equal(allChecked(parseAcceptance("## Log\n\n- 2026-09-14T09:00:00Z a created\n")), true);
});

test("有一条没勾就不满足", () => {
  assert.equal(allChecked(parseAcceptance(body)), false);
  assert.equal(allChecked(parseAcceptance("## Acceptance Criteria\n\n- [x] a\n- [x] b\n")), true);
});

test("line 指向原文里的那一行 —— F09 的勾选要靠它定位", () => {
  const lines = body.split("\n");
  for (const c of parseAcceptance(body)) {
    assert.match(lines[c.line] ?? "", /^- \[[ xX]\] /, `第 ${c.n} 条的 line 指错了`);
    assert.ok((lines[c.line] ?? "").includes(c.text), `第 ${c.n} 条的文本对不上`);
  }
});

test("小节在下一个 ## 处结束，不会把日志行当成标准", () => {
  assert.equal(parseAcceptance(body).length, 2, "## Log 里的条目不能算进来");
});

test("小节名要精确匹配，不认 ### 或大小写不同的", () => {
  // spec §5.3：四个 H2 标题「exactly and case-sensitively」。
  assert.equal(parseAcceptance("### Acceptance Criteria\n\n- [ ] x\n").length, 0);
  assert.equal(parseAcceptance("## acceptance criteria\n\n- [ ] x\n").length, 0);
});

test("文本是去掉复选框之后的原文，首尾空白去掉", () => {
  const cs = parseAcceptance("## Acceptance Criteria\n\n- [ ]   spaced out   \n");
  assert.equal(cs[0]?.text, "spaced out");
});

test("复选框里既不是空格也不是 x 的行不算标准", () => {
  // `- [?] x` 不是 GitHub 任务项，按「非复选框行」处理：保留但不计数。
  assert.equal(parseAcceptance("## Acceptance Criteria\n\n- [?] weird\n").length, 0);
});

// ---- sectionLines：小节查找抽出来共享（F09 的写入端也要用）----

test("sectionLines 给出小节内每一行及其行号", () => {
  const got = sectionLines(body, "## Acceptance Criteria");
  assert.deepEqual(got.map((l) => l.text), [
    "", "- [ ] first", "  - [x] nested does not count", "- [X] second uppercase",
    "- a bare note, not a criterion", "",
  ]);
  assert.equal(body.split("\n")[got[1]!.index], "- [ ] first");
});

test("sectionLines 对不存在的小节返回空", () => {
  assert.deepEqual(sectionLines(body, "## Plan"), []);
});

test("sectionLines 与既有的 logLines 行为一致", async () => {
  // logLines 改成了复用 sectionLines。两者对同一份正文必须给出同样的日志行，
  // 否则 doctor 与 isUnverified 的行为会跟着变。
  const { logLines } = await import("../../src/domain/validate.ts");
  const viaSection = sectionLines(body, "## Log")
    .map((l) => l.text).filter((t) => t.startsWith("- "));
  assert.deepEqual(logLines(body), viaSection);
});
