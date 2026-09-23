import { test } from "node:test";
import assert from "node:assert";
import { evaluateGates, worstCode, type GateInput, type Refusal } from "../../src/domain/gates.ts";
import { indexTasks } from "../../src/domain/derive.ts";
import type { TaskFile } from "../../src/domain/types.ts";

const ME = "me@host";
const OTHER = "other@host";

function task(id: string, fm: Record<string, unknown> = {}, body = ""): TaskFile {
  return {
    path: `tasks/${id}.md`, idFromFilename: id,
    frontmatter: {
      id, title: `title of ${id}`, status: "open",
      created: "2026-09-14T09:00:00Z", updated: "2026-09-14T09:00:00Z", ...fm,
    },
    body, raw: "",
  };
}

const AC = (...items: string[]) => ["## Acceptance Criteria", "", ...items, ""].join("\n");

function input(over: Partial<GateInput> & { tasks?: TaskFile[] } = {}): GateInput {
  const tasks = over.tasks ?? [over.task ?? task("tp-000001")];
  const target = over.task ?? tasks[0]!;
  return {
    task: target,
    index: indexTasks(tasks),
    actor: ME,
    transition: "close",
    lease: null,
    ...over,
  };
}

test("全部就绪时没有拒绝", () => {
  assert.deepEqual(evaluateGates(input()), []);
});

test("有未勾的标准 → acceptance，退出 2，逐条带序号与原文", () => {
  const t = task("tp-000001", {}, AC("- [x] done one", "- [ ] not yet", "- [ ] also not"));
  const rs = evaluateGates(input({ task: t }));
  assert.equal(rs.length, 1);
  const r = rs[0]!;
  assert.equal(r.gate, "acceptance");
  assert.equal(r.code, 2);
  assert.deepEqual(r.gate === "acceptance" ? r.unchecked.map((c) => [c.n, c.text]) : null,
    [[2, "not yet"], [3, "also not"]]);
});

test("全部勾上就不拒绝", () => {
  const t = task("tp-000001", {}, AC("- [x] a", "- [X] b"));
  assert.deepEqual(evaluateGates(input({ task: t })), []);
});

test("有未关闭的子任务 → children，退出 2，带 id / title / status", () => {
  const parent = task("tp-000001");
  const kid1 = task("tp-000002", { parent: "tp-000001", status: "in_progress", assignee: OTHER });
  const kid2 = task("tp-000003", { parent: "tp-000001", status: "closed", resolution: "done" });
  const rs = evaluateGates(input({ task: parent, tasks: [parent, kid1, kid2] }));
  assert.equal(rs.length, 1);
  const r = rs[0]!;
  assert.equal(r.gate, "children");
  assert.equal(r.code, 2);
  assert.deepEqual(r.gate === "children" ? r.open : null,
    [{ id: "tp-000002", title: "title of tp-000002", status: "in_progress" }]);
});

test("assignee 是别人 → ownership，退出 3，带持有者与其最近写入时间", () => {
  const t = task("tp-000001", { status: "in_progress", assignee: OTHER, updated: "2026-09-14T11:00:00Z" });
  const rs = evaluateGates(input({ task: t }));
  assert.equal(rs.length, 1);
  const r = rs[0]!;
  assert.equal(r.gate, "ownership");
  assert.equal(r.code, 3);
  assert.equal(r.gate === "ownership" ? r.holder : null, OTHER);
  assert.equal(r.gate === "ownership" ? r.heldSince : null, "2026-09-14T11:00:00Z");
});

test("assignee 是我自己不拒绝", () => {
  const t = task("tp-000001", { status: "in_progress", assignee: ME });
  assert.deepEqual(evaluateGates(input({ task: t })), []);
});

test("共享租约属于别人 → ownership，即使本树 assignee 还记着我", () => {
  // D019 的边界：租约跨 worktree 共享而任务文件不共享。本树文件说是我的，
  // 完全可能是过期视图。这条边界在 F05 立了三次、漏了三次，这里一次到位。
  const t = task("tp-000001", { status: "in_progress", assignee: ME });
  const rs = evaluateGates(input({
    task: t,
    lease: { actor: OTHER, claimed_at: "2026-09-14T10:00:00Z", heartbeat_at: "2026-09-14T11:00:00Z" },
  }));
  assert.equal(rs.length, 1);
  assert.equal(rs[0]!.gate, "ownership");
  assert.equal(rs[0]!.code, 3);
});

test("共享租约是我自己的不拒绝", () => {
  const t = task("tp-000001", { status: "in_progress", assignee: ME });
  assert.deepEqual(evaluateGates(input({
    task: t, lease: { actor: ME, claimed_at: "2026-09-14T10:00:00Z", heartbeat_at: "2026-09-14T11:00:00Z" },
  })), []);
});

test("未勾 + 别人持有 → 两条拒绝都在，退出码取 3", () => {
  // 报告要列出**全部**未通过的门禁——agent 该一次把活修完，
  // 而不是修一条重跑一次再看到下一条。
  const t = task("tp-000001", { status: "in_progress", assignee: OTHER }, AC("- [ ] not yet"));
  const rs = evaluateGates(input({ task: t }));
  assert.deepEqual(rs.map((r) => r.gate).sort(), ["acceptance", "ownership"]);
  assert.equal(worstCode(rs), 3, "归属是关于权限的，比就绪更严重");
});

test("三道门一起不过时也全部列出", () => {
  const parent = task("tp-000001", { status: "in_progress", assignee: OTHER }, AC("- [ ] a"));
  const kid = task("tp-000002", { parent: "tp-000001" });
  const rs = evaluateGates(input({ task: parent, tasks: [parent, kid] }));
  assert.deepEqual(rs.map((r) => r.gate).sort(), ["acceptance", "children", "ownership"]);
  assert.equal(worstCode(rs), 3);
});

test("close / done 对已关闭的任务 → state，退出 2", () => {
  const t = task("tp-000001", { status: "closed", resolution: "done" });
  for (const transition of ["done", "close"] as const) {
    const rs = evaluateGates(input({ task: t, transition }));
    assert.equal(rs.length, 1, transition);
    assert.equal(rs[0]!.gate, "state");
    assert.equal(rs[0]!.code, 2);
  }
});

test("reopen 对未关闭的任务 → state，退出 2", () => {
  for (const status of ["open", "in_progress"]) {
    const t = task("tp-000001", status === "in_progress" ? { status, assignee: ME } : { status });
    const rs = evaluateGates(input({ task: t, transition: "reopen" }));
    assert.equal(rs.length, 1, status);
    assert.equal(rs[0]!.gate, "state");
  }
});

test("reopen 对已关闭的任务不查归属 —— 关闭的任务没有持有者", () => {
  // 归属门禁判的是「另一个 actor 正在这个任务上工作」。任务已关闭就没人在工作，
  // 而 spec §6.2 不变量 3 允许 closed 保留 assignee（记录是谁关的）。
  const t = task("tp-000001", { status: "closed", resolution: "done", assignee: OTHER });
  assert.deepEqual(evaluateGates(input({ task: t, transition: "reopen" })), []);
});

test("reopen 不查验收标准与子任务", () => {
  const parent = task("tp-000001", { status: "closed", resolution: "done" }, AC("- [ ] a"));
  const kid = task("tp-000002", { parent: "tp-000001" });
  assert.deepEqual(evaluateGates(input({ task: parent, tasks: [parent, kid], transition: "reopen" })), []);
});

test("worstCode 取最严重的一条，与顺序无关", () => {
  assert.equal(worstCode([]), 0);
  // evaluateGates 里归属总是先 push，所以「取第一条」和「取最大」在它的输出上
  // 恰好一样——直接喂一个最严重的不在首位的数组，才测得出这个区别。
  const acceptance: Refusal = { gate: "acceptance", code: 2, unchecked: [] };
  const ownership: Refusal = { gate: "ownership", code: 3, holder: OTHER, heldSince: "" };
  assert.equal(worstCode([acceptance, ownership]), 3, "最严重的在末位也要取到");
  assert.equal(worstCode([ownership, acceptance]), 3);
  assert.equal(worstCode([acceptance]), 2);
});

test("子任务的子任务不算 —— 只看直接子任务", () => {
  // spec §6.1 说 require every child closed；孙子是子任务自己的门禁。
  const parent = task("tp-000001");
  const kid = task("tp-000002", { parent: "tp-000001", status: "closed", resolution: "done" });
  const grandkid = task("tp-000003", { parent: "tp-000002" });
  assert.deepEqual(evaluateGates(input({ task: parent, tasks: [parent, kid, grandkid] })), []);
});
