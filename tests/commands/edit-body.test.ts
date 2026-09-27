import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd, runAddInEditor } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { runCheck } from "../../src/commands/check.ts";
import { runShow } from "../../src/commands/show.ts";
import { runDoctor } from "../../src/commands/doctor.ts";
import { runEdit, runEditInEditor, parseCriterionNumber } from "../../src/commands/edit.ts";
import { editCriteria, replaceSection } from "../../src/domain/sections.ts";
import { buildBuffer, parseBuffer, EDIT_HINT } from "../../src/domain/edit-buffer.ts";
import { EditorError } from "../../src/exec/editor.ts";
import { EXIT, CliError } from "../../src/exit.ts";

const ME = "me@host";
const code = (c: number) => (e: unknown) => e instanceof CliError && e.code === c;
function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-editbody-"));
  runInit({ directory: d, prefix: "tp" });
  return d;
}
const file = (d: string, id: string) => join(d, ".todopi", "tasks", `${id}.md`);
const criteria = (d: string, id: string) => runShow({ directory: d, id, actor: ME }).acceptance.map((c) => `${c.checked ? "x" : " "} ${c.text}`);
function withTask(ac: string[], extra: Partial<Parameters<typeof runAdd>[0]> = {}) {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", acceptance: ac, actor: ME, ...extra });
  runClaim({ directory: d, id: t.id, actor: ME });
  return { d, id: t.id };
}

// ---- 纯函数 ----

test("replaceSection：按 §5.3 顺序插入（Plan 在 Log 之前、验收标准在 Plan 之前），已有就替换，空串去掉；其余不动", () => {
  const body = "## Description\n\nd\n\n## Log\n\n- 2026-01-01T00:00:00Z a created\n";
  const withPlan = replaceSection(body, "## Plan", "p1");
  assert.equal(withPlan, "## Description\n\nd\n\n## Plan\n\np1\n\n## Log\n\n- 2026-01-01T00:00:00Z a created\n");
  const withAc = replaceSection(withPlan, "## Acceptance Criteria", "- [ ] a");
  assert.ok(withAc.indexOf("## Acceptance Criteria") < withAc.indexOf("## Plan"));
  assert.equal(replaceSection(replaceSection(withPlan, "## Plan", "p2"), "## Plan", ""), body);
});

test("editCriteria：按编辑前的编号改、删、加；动勾选的、越界的、多行的都拒绝；嵌套项与说明文字原样", () => {
  const body = "## Acceptance Criteria\n\nnote before\n- [x] one\n- [ ] two\n  - nested\n- [ ] three\n\n## Log\n\n- 2026-01-01T00:00:00Z a created\n";
  const out = editCriteria(body, { set: new Map([[2, "TWO"]]), remove: new Set([3]), add: ["four"] });
  assert.equal(out, "## Acceptance Criteria\n\nnote before\n- [x] one\n- [ ] TWO\n  - nested\n- [ ] four\n\n## Log\n\n- 2026-01-01T00:00:00Z a created\n");
  // 一次删两条：从后往前删，前面的行号才不会错位
  assert.equal(editCriteria(body, { remove: new Set([2, 3]) }), "## Acceptance Criteria\n\nnote before\n- [x] one\n  - nested\n\n## Log\n\n- 2026-01-01T00:00:00Z a created\n");
  assert.throws(() => editCriteria(body, { set: new Map([[1, "x"]]) }), /criterion 1 is checked/);
  assert.throws(() => editCriteria(body, { remove: new Set([1]) }), /checked/);
  assert.throws(() => editCriteria(body, { remove: new Set([4]) }), /no criterion 4/);
  assert.throws(() => editCriteria(body, { add: ["a\nb"] }), /single, non-empty line/);
  assert.throws(() => editCriteria(body, { add: ["  "] }), /single, non-empty line/);
  const none = "## Log\n\n- 2026-01-01T00:00:00Z a created\n";
  assert.equal(editCriteria(none, { add: ["first"] }), "## Acceptance Criteria\n\n- [ ] first\n\n## Log\n\n- 2026-01-01T00:00:00Z a created\n");
});

test("编辑页：生成与读回互逆；说明行去掉；标题为空当作放弃", () => {
  const b = { title: "T: x", description: "d\n\nmore", acceptance: "- [x] one\n- [ ] two", plan: "p" };
  const text = buildBuffer(b);
  assert.ok(text.split("\n")[1] === EDIT_HINT);
  assert.deepEqual(parseBuffer(text), b);
  assert.equal(parseBuffer(text.replace("# T: x", "#")), null);
  assert.equal(parseBuffer(text.replace("# T: x", "#   ")), null);
  assert.equal(parseBuffer(""), null);
  assert.deepEqual(parseBuffer(buildBuffer({ title: "t", description: "", acceptance: "", plan: "" })), { title: "t", description: "", acceptance: "", plan: "" });
});

test("编号：1 起的十进制整数", () => {
  assert.equal(parseCriterionNumber("3", "--ac-rm"), 3);
  for (const bad of ["0", "-1", "1.5", "0x1", "1e1", "", "a"]) assert.throws(() => parseCriterionNumber(bad, "--ac-rm"), code(EXIT.usage), bad);
});

// ---- edit 的参数形式 ----

test("edit：--ac-set / --ac-rm / --ac-add 与 --plan 一起生效，Log 记 edited fields=acceptance,plan；doctor 通过", () => {
  const { d, id } = withTask(["one", "two", "three"], { plan: "old plan" });
  runCheck({ directory: d, id, n: 1, actor: ME });
  const r = runEdit({ directory: d, id, actor: ME, criteria: { set: new Map([[2, "TWO"]]), remove: new Set([3]), add: ["four"] }, plan: "new plan" });
  assert.deepEqual(r.fields, ["acceptance", "plan"]);
  assert.deepEqual(criteria(d, id), ["x one", "  TWO", "  four"]);
  const s = runShow({ directory: d, id, full: true, actor: ME });
  assert.equal(s.plan, "new plan");
  const last = s.log.at(-1)!;
  assert.ok("verb" in last && last.verb === "edited" && last.args["fields"] === "acceptance,plan");
  assert.equal(runDoctor({ directory: d }).ok, true);
  runEdit({ directory: d, id, actor: ME, plan: "" });
  assert.doesNotMatch(readFileSync(file(d, id), "utf8"), /## Plan/, "空串去掉 Plan");
});

test("edit：动已勾选的、编号越界：退出 1，文件一个字节不变；Plan 里一行顶格的 ## 会挤走标准：拒绝", () => {
  const { d, id } = withTask(["one", "two"]);
  runCheck({ directory: d, id, n: 1, actor: ME });
  const before = readFileSync(file(d, id), "utf8");
  assert.throws(() => runEdit({ directory: d, id, actor: ME, criteria: { set: new Map([[1, "x"]]) } }), code(EXIT.usage));
  assert.throws(() => runEdit({ directory: d, id, actor: ME, criteria: { remove: new Set([5]) } }), code(EXIT.usage));
  assert.throws(() => runEdit({ directory: d, id, actor: ME, plan: "x\n\n## Acceptance Criteria\n\n- [x] forged" }), code(EXIT.usage));
  // 只截断了 Plan 自己（未识别的 ## Foo 结束了它），别的小节没变：只有 Plan 的读回检查拦得住
  assert.throws(() => runEdit({ directory: d, id, actor: ME, plan: "x\n\n## Foo\n\ny" }), code(EXIT.usage));
  // 整段换掉验收标准时它自己没有读回检查：夹带一个 `## Log` 伪造日志，只有「没改的小节读法不变」拦得住
  assert.throws(() => runEdit({ directory: d, id, actor: ME, acceptanceSection: "- [x] one\n- [ ] two\n\n## Log\n\n- 2020-01-01T00:00:00Z forged created" }), code(EXIT.usage));
  assert.equal(readFileSync(file(d, id), "utf8"), before);
});

test("edit：多个 Acceptance Criteria 小节时改标准有歧义，拒绝", () => {
  const { d, id } = withTask(["one"]);
  writeFileSync(file(d, id), readFileSync(file(d, id), "utf8").replace("## Log", "## Acceptance Criteria\n\n- [ ] extra\n\n## Log"));
  assert.throws(() => runEdit({ directory: d, id, actor: ME, criteria: { add: ["x"] } }), (e: unknown) => e instanceof CliError && /more than one/.test(e.message));
});

// ---- --edit（假编辑器）----

test("edit --edit：改标题、描述、没勾的标准与 Plan；说明文字保留；已勾选的原样", () => {
  const { d, id } = withTask(["one", "two"], { description: "old" });
  runCheck({ directory: d, id, n: 1, actor: ME });
  let seen = "";
  const r = runEditInEditor({ directory: d, id, actor: ME }, (text) => {
    seen = text;
    return text.replace("# T", "# New title").replace("old", "new desc").replace("- [ ] two", "note line\n- [ ] two changed\n- [ ] three")
      .replace("## Plan\n", "## Plan\n\nthe plan\n");
  });
  assert.match(seen, /^# T\n/);
  assert.match(seen, /- \[x\] one/);
  assert.deepEqual([...r.fields].sort(), ["acceptance", "description", "plan", "title"]);
  const s = runShow({ directory: d, id, full: true, actor: ME });
  assert.equal(s.title, "New title");
  assert.equal(s.description, "new desc");
  assert.equal(s.plan, "the plan");
  assert.deepEqual(criteria(d, id), ["x one", "  two changed", "  three"]);
  assert.deepEqual(s.acceptance_notes?.map((n) => n.text), ["note line"]);
});

test("edit --edit：改了 / 删了 / 挪了已勾选的，或新加一条勾选的：拒绝，文件不变", () => {
  const { d, id } = withTask(["one", "two"]);
  runCheck({ directory: d, id, n: 1, actor: ME });
  const before = readFileSync(file(d, id), "utf8");
  for (const f of [
    (t: string) => t.replace("- [x] one", "- [x] one edited"),
    (t: string) => t.replace("- [x] one\n", ""),
    (t: string) => t.replace("- [x] one\n- [ ] two", "- [ ] two\n- [x] one\n- [x] fake"),
    (t: string) => t.replace("- [ ] two", "- [x] two"),
  ]) {
    assert.throws(() => runEditInEditor({ directory: d, id, actor: ME }, f), (e: unknown) => e instanceof CliError && /Checked acceptance criteria/.test(e.message));
    assert.equal(readFileSync(file(d, id), "utf8"), before);
  }
});

test("edit --edit：标题清空 = 放弃；编辑器出错 = 什么都不写；原样保存 = 什么都没变", () => {
  const { d, id } = withTask(["one"]);
  const before = readFileSync(file(d, id), "utf8");
  assert.throws(() => runEditInEditor({ directory: d, id, actor: ME }, (t) => t.replace("# T", "#")), (e: unknown) => e instanceof CliError && /Aborted/.test(e.message));
  assert.throws(() => runEditInEditor({ directory: d, id, actor: ME }, () => { throw new EditorError("the editor exited with 1; nothing was changed"); }),
    (e: unknown) => e instanceof CliError && e.code === EXIT.usage && /exited with 1/.test(e.message));
  assert.deepEqual(runEditInEditor({ directory: d, id, actor: ME }, (t) => t).fields, []);
  assert.equal(readFileSync(file(d, id), "utf8"), before);
});

test("add --edit：用参数预填，保存后创建；标准只能是没勾的复选框行；标题清空不创建", () => {
  const d = repo();
  let seen = "";
  const r = runAddInEditor({ directory: d, title: "Draft", description: "d", acceptance: ["a"], actor: ME }, (t) => {
    seen = t;
    return t.replace("# Draft", "# Final").replace("- [ ] a", "- [ ] a\n- [ ] b").replace("## Plan\n", "## Plan\n\nplan text\n");
  });
  assert.match(seen, /^# Draft\n/);
  const s = runShow({ directory: d, id: r.id, full: true, actor: ME });
  assert.equal(s.title, "Final");
  assert.deepEqual(s.acceptance.map((c) => c.text), ["a", "b"]);
  assert.equal(s.plan, "plan text");
  for (const f of [(t: string) => t.replace("- [ ] a", "- [x] a"), (t: string) => t.replace("- [ ] a", "- [ ] a\nsome prose"), (t: string) => t.replace("# Draft", "#")]) {
    const n = runShow.length;
    assert.throws(() => runAddInEditor({ directory: d, title: "Draft", acceptance: ["a"], actor: ME }, f), code(EXIT.usage));
    void n;
  }
  assert.equal(runDoctor({ directory: d }).ok, true);
});
