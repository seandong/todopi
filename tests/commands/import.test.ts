import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runImport, sourceFor, encodeSource } from "../../src/commands/import.ts";
import { runLs } from "../../src/commands/ls.ts";
import { runShow } from "../../src/commands/show.ts";
import { runMove } from "../../src/commands/move.ts";
import { runDoctor } from "../../src/commands/doctor.ts";
import { parseChecklist, type ChecklistNode } from "../../src/markdown/checklist.ts";
import { planImport, importedKeys } from "../../src/domain/import-plan.ts";
import { readTasks } from "../../src/format/read.ts";
import { discoverLedger } from "../../src/format/discover.ts";
import { EXIT, CliError } from "../../src/exit.ts";

const ME = "me@host";
const code = (c: number) => (e: unknown) => e instanceof CliError && e.code === c;
function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-import-"));
  runInit({ directory: d, prefix: "tp" });
  return d;
}
function plan(d: string, name: string, text: string): string {
  const p = join(d, name);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
  return p;
}
/** 树的简写：heading 写成 "# 文字"，条目写成 "[ ] 文字" / "[x] 文字" */
function shape(nodes: ChecklistNode[]): unknown[] {
  return nodes.map((n) => {
    const head = n.kind === "heading" ? `${"#".repeat(n.level)} ${n.text}` : `[${n.checked ? "x" : " "}] ${n.text}`;
    return n.children.length === 0 ? head : [head, shape(n.children)];
  });
}

// ---- 解析 ----

test("清单解析：标题按层级嵌套，条目挂在所在标题下；嵌套条目挂在上一条目下；普通项目符号下的条目挂到外层", () => {
  const md = [
    "- [ ] before any heading",
    "# Plan", "", "## A", "",
    "- [ ] one", "  - [x] one.a", "  - plain", "    - [ ] one.b under plain",
    "- plain bullet", "  - [X] two",
    "", "### A.1", "", "- [ ] three",
    "", "## B", "", "1. [ ] ordered item",
  ].join("\n");
  assert.deepEqual(shape(parseChecklist(md)), [
    "[ ] before any heading",
    ["# Plan", [
      ["## A", [
        ["[ ] one", ["[x] one.a", "[ ] one.b under plain"]],
        "[x] two",
        ["### A.1", ["[ ] three"]],
      ]],
      ["## B", ["[ ] ordered item"]],
    ]],
  ]);
});

test("清单解析：代码块、块引用外的示例不是条目；[ ] 后必须有空白；文字取纯文本（强调、代码、链接去掉）", () => {
  const md = [
    "# P", "",
    "```markdown", "- [ ] in a fence", "```", "",
    "    - [ ] indented code", "",
    "- [ ]no space",
    "- [] not a box",
    "- [ ] **Step 1:** run `todopi ls` and see [docs](https://example.com)  ",
    "  continued line",
    "- # [ ] a heading inside a list item is not an item",
  ].join("\n");
  assert.deepEqual(shape(parseChecklist(md)), [["# P", ["[ ] Step 1: run todopi ls and see docs continued line"]]]);
});

test("分隔线结束一级标题以下的小节（Superpowers 模板：Global Constraints --- Task N）", () => {
  const md = ["# Plan", "## Global Constraints", "- Node 22", "---", "### Task 1: X", "- [ ] step", "---", "### Task 2: Y", "- [ ] step"].join("\n");
  assert.deepEqual(shape(parseChecklist(md)), [["# Plan", [
    "## Global Constraints",
    ["### Task 1: X", ["[ ] step"]],
    ["### Task 2: Y", ["[ ] step"]],
  ]]]);
});

// ---- 映射 ----

test("映射：没有条目的标题不成任务；同一父级下同名的加序号，不同父级下同名的各自独立；前序（父在子前）", () => {
  const md = ["# Plan", "## Notes", "text", "", "---",
    "### Task 1", "- [ ] Step 1: Write the failing test", "- [ ] Step 1: Write the failing test",
    "---", "### Task 2", "- [ ] Step 1: Write the failing test"].join("\n");
  const p = planImport(parseChecklist(md));
  assert.deepEqual(p.tasks.map((t) => t.title), ["Plan", "Task 1", "Step 1: Write the failing test", "Step 1: Write the failing test", "Task 2", "Step 1: Write the failing test"]);
  assert.equal(new Set(p.tasks.map((t) => t.key)).size, 6, "键各不相同");
  const byKey = new Map(p.tasks.map((t) => [t.key, t]));
  for (const t of p.tasks.slice(1)) assert.ok(byKey.has(t.parentKey!), `${t.title} 的父级在它之前`);
  assert.ok(p.tasks.findIndex((t) => t.key === p.tasks[2]!.parentKey) < 2);
});

test("映射：勾选条目在子项全部关闭时建成关闭；标题在全部子项关闭时关闭；勾了但子项没勾的建成 open 并警告", () => {
  const md = ["## Done section", "- [x] a", "- [x] b", "  - [x] b.1",
    "## Mixed", "- [x] c", "  - [ ] c.1", "- [ ] d",
    "## Open first", "- [ ] e", "- [x] f",
    "## Lifted", "- [x] g", "###", "- [ ] h"].join("\n");
  const p = planImport(parseChecklist(md));
  const closed = Object.fromEntries(p.tasks.map((t) => [t.title, t.closed]));
  assert.deepEqual(closed, { "Done section": true, a: true, b: true, "b.1": true, Mixed: false, c: false, "c.1": false, d: false,
    "Open first": false, e: false, f: true, Lifted: false, g: true, h: false });
  assert.equal(p.warnings.length, 1);
  assert.match(p.warnings[0]!.message, /"c" is checked but has unchecked sub-items/);
});

test("映射：超过 200 字符的标题截断、原文进描述；空标题不成任务、下面的条目挂到上一级；只有 [ ] 没有文字的不是条目", () => {
  const exact = "y".repeat(200);
  assert.equal(planImport(parseChecklist(`- [ ] ${exact}`)).tasks[0]!.title, exact, "恰好 200 个字符不截断");
  const long = "x".repeat(250);
  const p = planImport(parseChecklist(["## S", `- [ ] ${long}`, "- [ ] ", "  - [ ] under empty box", "###", "- [ ] under empty heading"].join("\n")));
  const t = p.tasks.find((x) => x.title.startsWith("xxx"))!;
  assert.equal([...t.title].length, 200);
  assert.ok(t.title.endsWith("\u2026"));
  assert.equal(t.description, long);
  const s = p.tasks.find((x) => x.title === "S")!;
  for (const title of ["under empty box", "under empty heading"]) {
    assert.equal(p.tasks.find((x) => x.title === title)!.parentKey, s.key, title);
  }
  assert.deepEqual(p.tasks.map((x) => x.title).filter((x) => x.trim() === ""), []);
  // 纯文本为空（只有行内 HTML）的也不是条目：子项挂到外层
  const q = planImport(parseChecklist(["## S", "- [ ] <b></b>", "  - [ ] kid"].join("\n")));
  assert.deepEqual(q.tasks.map((x) => x.title), ["S", "kid"]);
  assert.equal(q.tasks[1]!.parentKey, q.tasks[0]!.key);
});

// ---- 导入 ----

const SUPERPOWERS = `# Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Users can log in.

## Global Constraints

- Node 22

---

### Task 1: Session store

**Files:**
- Create: \`src/session.ts\`

- [x] **Step 1: Write the failing test**

\`\`\`ts
// - [ ] not a task
\`\`\`

- [x] **Step 2: Run test to verify it fails**

### Task 2: Login route

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
`;

test("导入 Superpowers 计划：层级变 parent、文档顺序变 rank、勾选的建成 closed/done forced=true、created 记 source；doctor 通过", () => {
  const d = repo();
  const r = runImport({ directory: d, file: plan(d, "docs/plans/login.md", SUPERPOWERS), actor: ME });
  assert.equal(r.source, "docs/plans/login.md");
  assert.deepEqual(r.created.map((t) => t.title), ["Login Implementation Plan", "Task 1: Session store",
    "Step 1: Write the failing test", "Step 2: Run test to verify it fails",
    "Task 2: Login route", "Step 1: Write the failing test", "Step 2: Run test to verify it fails"]);
  const [root, t1, s11, s12, t2, s21, s22] = r.created.map((t) => t.id);
  const shown = (id: string) => runShow({ directory: d, id: id!, full: true, actor: ME });
  assert.equal(shown(root!).parent, undefined);
  assert.equal(shown(t1!).parent, root);
  assert.equal(shown(s11!).parent, t1);
  assert.equal(shown(s21!).parent, t2);
  assert.equal(shown(s22!).parent, t2);
  // 文档顺序 = rank 顺序
  const ranks = r.created.map((t) => shown(t.id).rank!);
  assert.deepEqual([...ranks].sort(), ranks);
  // 勾选的：closed/done，forced=true，未验证；Task 1 的步骤全勾了，Task 1 也关闭
  for (const id of [s11, s12, t1]) {
    const s = shown(id!);
    assert.equal(s.status, "closed");
    assert.equal(s.resolution, "done");
    assert.equal(s.unverified, true);
    const done = s.log.find((e) => "verb" in e && e.verb === "done")!;
    assert.ok("args" in done && done.args["forced"] === "true" && done.args["verify"] === "none");
  }
  assert.equal(shown(root!).status, "open");
  assert.equal(shown(s21!).status, "open");
  for (const t of r.created) {
    const created = shown(t.id).log[0]!;
    assert.ok("verb" in created && created.verb === "created" && created.args["source"] === "docs/plans/login.md");
  }
  assert.equal(runDoctor({ directory: d }).findings.length, 0);
  assert.deepEqual(runLs({ directory: d, ready: true, actor: ME }).tasks.map((t) => t.id), [s21, s22]);
});

test("幂等：重复导入不建新任务；已有任务的 rank 保留（move 过也不重算）；计划里后来加的条目建出来、挂对父级、排在最后", () => {
  const d = repo();
  const file = plan(d, "plan.md", SUPERPOWERS);
  const first = runImport({ directory: d, file, actor: ME });
  const [, , s11, , , s21] = first.created.map((t) => t.id);
  runMove({ directory: d, id: s21!, top: true, actor: ME });
  const before = new Map(readTasks(discoverLedger(d)).map((t) => [t.idFromFilename, t.raw]));

  const again = runImport({ directory: d, file, actor: ME });
  assert.equal(again.created.length, 0);
  assert.equal(again.existing, 7);
  for (const t of readTasks(discoverLedger(d))) assert.equal(t.raw, before.get(t.idFromFilename), `${t.idFromFilename} 一个字节都没变`);

  writeFileSync(file, SUPERPOWERS + "- [ ] **Step 3: Implement**\n");
  const third = runImport({ directory: d, file, actor: ME });
  assert.equal(third.created.length, 1);
  assert.equal(third.existing, 7);
  const added = runShow({ directory: d, id: third.created[0]!.id, actor: ME });
  assert.equal(added.parent, first.created[4]!.id, "挂在 Task 2 下");
  const all = runLs({ directory: d, all: true, actor: ME }).tasks.map((t) => t.id);
  assert.equal(all.at(-1), added.id, "新条目排在最后");
  assert.equal(all[0], s21, "move 过的位置保留");
  void s11;
});

test("来源：项目内是相对路径；项目外是绝对路径；空白与 % 编码；不同来源的同名条目互不影响", () => {
  const d = repo();
  assert.equal(sourceFor(d, join(d, "a b", "p%.md")), "a%20b/p%25.md");
  assert.equal(sourceFor(d, "/elsewhere/p.md"), "/elsewhere/p.md");
  assert.equal(encodeSource("x\ty"), "x%09y");
  const a = runImport({ directory: d, file: plan(d, "a b/p.md", "- [ ] same\n"), actor: ME });
  assert.equal(a.source, "a%20b/p.md");
  const b = runImport({ directory: d, file: plan(d, "q.md", "- [ ] same\n"), actor: ME });
  assert.equal(b.created.length, 1, "别的来源里的同名条目不算已导入");
  assert.equal(runDoctor({ directory: d }).findings.length, 0);
});

test("importedKeys 与 planImport 的键一致（同名序号也一致）", () => {
  const d = repo();
  // 没有条目的同名标题被剪掉，它不该占一个同名序号（否则与账本里读回来的键对不上）
  const md = "## A\nprose\n## A\n- [ ] s\n- [ ] s\n## B\n- [ ] s\n";
  runImport({ directory: d, file: plan(d, "p.md", md), actor: ME });
  const keys = importedKeys(readTasks(discoverLedger(d)), "p.md");
  assert.deepEqual([...keys.keys()].sort(), planImport(parseChecklist(md)).tasks.map((t) => t.key).sort());
});

test("文件读不了、不是 UTF-8：退出 1，什么都不建；没有条目的文件：建 0 个", () => {
  const d = repo();
  assert.throws(() => runImport({ directory: d, file: join(d, "nope.md"), actor: ME }), code(EXIT.usage));
  const bad = join(d, "bad.md");
  writeFileSync(bad, Buffer.concat([Buffer.from("- [ ] a"), Buffer.from([0xff]), Buffer.from("\n")]));
  assert.throws(() => runImport({ directory: d, file: bad, actor: ME }), code(EXIT.usage));
  assert.equal(readTasks(discoverLedger(d)).length, 0);
  assert.equal(runImport({ directory: d, file: plan(d, "empty.md", "# Just prose\n\nNo boxes.\n"), actor: ME }).created.length, 0);
  void readFileSync;
});

test("spec-kit 与 OpenSpec 的 tasks.md", () => {
  const d = repo();
  const speckit = "# Tasks: Photo albums\n\n## Phase 1: Setup\n\n- [x] T001 Create project structure per implementation plan\n- [ ] T002 [P] Initialize project\n\n## Phase 2: Core\n\n- [ ] T003 [US1] Album model in src/models/album.py\n";
  const s = runImport({ directory: d, file: plan(d, "specs/001/tasks.md", speckit), actor: ME });
  assert.deepEqual(s.created.map((t) => [t.title, t.status]), [
    ["Tasks: Photo albums", "open"], ["Phase 1: Setup", "open"],
    ["T001 Create project structure per implementation plan", "closed"], ["T002 [P] Initialize project", "open"],
    ["Phase 2: Core", "open"], ["T003 [US1] Album model in src/models/album.py", "open"]]);
  const openspec = "## 1. Implementation\n- [x] 1.1 Create database schema\n- [x] 1.2 Implement API endpoint\n\n## 2. Testing\n- [ ] 2.1 Write tests\n";
  const o = runImport({ directory: d, file: plan(d, "openspec/changes/x/tasks.md", openspec), actor: ME });
  assert.deepEqual(o.created.map((t) => [t.title, t.status]), [
    ["1. Implementation", "closed"], ["1.1 Create database schema", "closed"], ["1.2 Implement API endpoint", "closed"],
    ["2. Testing", "open"], ["2.1 Write tests", "open"]]);
  assert.equal(runDoctor({ directory: d }).findings.length, 0);
});
