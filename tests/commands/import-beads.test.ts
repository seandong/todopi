import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runImportBeads, parseIssues } from "../../src/commands/import-beads.ts";
import { runLs } from "../../src/commands/ls.ts";
import { runShow } from "../../src/commands/show.ts";
import { runDoctor } from "../../src/commands/doctor.ts";
import { planBeadsImport, resolutionFor, normalizeLabel, utcSeconds, type BeadsIssue } from "../../src/domain/beads.ts";
import { readTasks } from "../../src/format/read.ts";
import { discoverLedger } from "../../src/format/discover.ts";
import { EXIT, CliError } from "../../src/exit.ts";

const ME = "me@host";
const code = (c: number) => (e: unknown) => e instanceof CliError && e.code === c;
function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-beads-"));
  runInit({ directory: d, prefix: "tp" });
  return d;
}
function beads(d: string, issues: object[], rel = ".beads/issues.jsonl"): string {
  const p = join(d, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, issues.map((i) => JSON.stringify(i)).join("\n") + "\n");
  return p;
}
const dep = (issue: string, on: string, type: string) => ({ issue_id: issue, depends_on_id: on, type, created_at: "2026-01-01T00:00:00Z" });
const T0 = "2026-01-02T03:04:05.678-08:00";

/** Beads v0.47.1 的字段形状（internal/types/types.go 的 json 标签） */
const SAMPLE = [
  { id: "bd-epic", title: "Auth epic", status: "open", priority: 1, issue_type: "epic", created_at: T0, updated_at: T0 },
  { id: "bd-a", title: "Login form", status: "in_progress", priority: 2, issue_type: "feature", assignee: "alice", labels: ["UI Work", "web"],
    created_at: "2026-01-03T00:00:00Z", updated_at: T0, dependencies: [dep("bd-a", "bd-epic", "parent-child"), dep("bd-a", "bd-b", "blocks")] },
  { id: "bd-b", title: "Session store", status: "closed", priority: 0, issue_type: "task", created_at: "2026-01-04T00:00:00Z", updated_at: T0,
    closed_at: T0, close_reason: "Implemented in commit abc", dependencies: [dep("bd-b", "bd-epic", "parent-child")] },
  { id: "bd-c", title: "Old idea", status: "closed", priority: 3, issue_type: "bug", created_at: T0, updated_at: T0, closed_at: T0,
    close_reason: "Won't fix: out of scope", dependencies: [dep("bd-c", "bd-a", "discovered-from"), dep("bd-c", "bd-a", "related")] },
  { id: "bd-d", title: "Same as b", status: "closed", priority: 4, issue_type: "task", created_at: T0, updated_at: T0, close_reason: "Duplicate of bd-b" },
  { id: "bd-gone", title: "Deleted", status: "tombstone", priority: 2, issue_type: "task", created_at: T0, updated_at: T0 },
  { id: "bd-wisp", title: "Session ended", status: "closed", priority: 2, issue_type: "event", ephemeral: true, created_at: T0, updated_at: T0 },
];

// ---- 纯函数 ----

test("resolution：重复类开头 → duplicate；放弃类开头 → wontfix；其余（包括中间提到 stale 的）→ done", () => {
  for (const r of ["Duplicate of bd-1", "dup of x", "dupe"]) assert.equal(resolutionFor(r), "duplicate", r);
  for (const r of ["Won't fix", "wontfix", "will not fix", "Not planned", "Abandoned", "Cancelled", "Invalid", "Stale/spurious - x",
    "Wrong repo - y", "not a bug", "Obsolete", "Superseded by bd-2", "No longer needed"]) assert.equal(resolutionFor(r), "wontfix", r);
  for (const r of [undefined, "", "Fixed stale cache", "Implemented", "Closed", "Merged to main", "duplicated logic removed",
    "Invalidated the cache on write", "Stalemate resolved", "Cancellation flow implemented"]) {
    assert.equal(resolutionFor(r), "done", String(r));
  }
});

test("label 规范化：小写、非法字符换成 -、截到 32；规范不了返回 null", () => {
  assert.equal(normalizeLabel("UI Work"), "ui-work");
  assert.equal(normalizeLabel("merge-request"), "merge-request");
  assert.equal(normalizeLabel("area:auth"), "area-auth");
  assert.equal(normalizeLabel("x".repeat(40)), "x".repeat(32));
  assert.equal(normalizeLabel("--"), null);
  assert.equal(normalizeLabel("_Beta"), "beta", "开头的非法字符去掉");
  assert.equal(normalizeLabel("日本"), null);
});

test("时间戳：带小数秒与时区偏移的 → UTC 秒级 Z；读不懂的 → undefined", () => {
  assert.equal(utcSeconds(T0), "2026-01-02T11:04:05Z");
  assert.equal(utcSeconds("2026-01-02T03:04:05Z"), "2026-01-02T03:04:05Z");
  for (const bad of [undefined, "", "yesterday", "2026-01-02", "2026-02-30T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T00:00:00+25:00"]) {
    assert.equal(utcSeconds(bad), undefined, String(bad));
  }
});

test("计划：tombstone 与 ephemeral 跳过；parent / blocked_by 的目标先建（拓扑序）；rank 顺序按 priority", () => {
  const p = planBeadsImport(SAMPLE as BeadsIssue[], new Set(), () => true);
  assert.deepEqual(p.skipped, { tombstone: 1, ephemeral: 1, existing: 0 });
  const at = (id: string) => p.tasks.findIndex((t) => t.beadsId === id);
  assert.ok(at("bd-epic") < at("bd-a") && at("bd-b") < at("bd-a") && at("bd-epic") < at("bd-b"), "引用的目标先建");
  const order = [...p.tasks].sort((a, b) => a.order - b.order).map((t) => t.beadsId);
  assert.deepEqual(order, ["bd-b", "bd-epic", "bd-a", "bd-c", "bd-d"], "priority 0 最先");
  assert.equal(p.dropped.otherEdgeTypes, 1, "related 没有对应物");
});

test("计划：成环的依赖丢掉一条边并警告；多个父级取第一个；指向没导入的条目的边丢掉", () => {
  const issues = [
    { id: "x", title: "X", priority: 1, dependencies: [dep("x", "y", "blocks")] },
    { id: "y", title: "Y", priority: 1, dependencies: [dep("y", "x", "blocks"), dep("y", "p1", "parent-child"), dep("y", "p2", "parent-child"), dep("y", "ghost", "blocks")] },
    { id: "p1", title: "P1", priority: 1 }, { id: "p2", title: "P2", priority: 1 },
  ] as BeadsIssue[];
  const p = planBeadsImport(issues, new Set(), () => true);
  assert.equal(p.dropped.cycleEdges, 1);
  assert.equal(p.dropped.extraParents, 1);
  assert.equal(p.dropped.danglingEdges, 1);
  const y = p.tasks.find((t) => t.beadsId === "y")!;
  assert.equal(y.parent, "p1");
  const x = p.tasks.find((t) => t.beadsId === "x")!;
  assert.equal(x.blockedBy.length + y.blockedBy.length, 1, "环上只剩一条边");
  assert.match(p.warnings.join("\n"), /closes a cycle/);
});

test("描述：description + design + acceptance_criteria + notes 合在一起；会改变正文读法的整段放进围栏，原文不改", () => {
  const issue = { id: "z", title: "Z", description: "## Current State\n```\nunclosed", design: "D", acceptance_criteria: "AC", notes: "N" } as BeadsIssue;
  const safe = planBeadsImport([{ id: "s", title: "S", description: "plain" } as BeadsIssue], new Set(), () => true).tasks[0]!;
  assert.equal(safe.description, "plain");
  const t = planBeadsImport([issue], new Set(), () => false).tasks[0]!;
  assert.ok(t.description!.startsWith("````text\n"), "围栏比正文里最长的反引号串多一个");
  assert.ok(t.description!.includes("## Current State\n```\nunclosed\n\nDesign (from Beads):\n\nD\n\nAcceptance criteria (from Beads):\n\nAC\n\nNotes (from Beads):\n\nN"));
  assert.ok(t.description!.endsWith("\n````"));
  const long = planBeadsImport([{ id: "l", title: "t".repeat(250) } as BeadsIssue], new Set(), () => true).tasks[0]!;
  assert.equal([...long.title].length, 200);
  assert.match(long.description!, /^Full title in Beads:/);
});

// ---- 导入 ----

test("导入：状态、resolution、labels、parent、blocked_by、from、external.beads.id、created 时间、Log；doctor 通过", () => {
  const d = repo();
  beads(d, SAMPLE);
  const r = runImportBeads({ directory: d, actor: ME });
  assert.equal(r.source, ".beads/issues.jsonl");
  assert.equal(r.created.length, 5);
  const id = (b: string) => r.created.find((t) => t.beads_id === b)!.id;
  const show = (b: string) => runShow({ directory: d, id: id(b), full: true, actor: ME });

  const a = show("bd-a");
  assert.equal(a.status, "open", "in_progress 不替人认领");
  assert.equal(a.assignee, undefined);
  assert.equal(a.parent, id("bd-epic"));
  assert.deepEqual(a.blocked_by, [id("bd-b")]);
  assert.deepEqual(a.labels, ["feature", "ui-work", "web"]);
  assert.deepEqual(a.external, { beads: { id: "bd-a" } });
  assert.equal(a.created, "2026-01-03T00:00:00Z");
  const imported = a.log.find((e) => "verb" in e && e.verb === "imported")!;
  assert.ok("args" in imported && imported.args["system"] === "beads" && imported.args["source"] === ".beads/issues.jsonl");
  assert.match(("text" in imported && imported.text) || "", /Beads bd-a; status in_progress; priority P2; assignee alice/);

  const b = show("bd-b");
  assert.equal(b.status, "closed");
  assert.equal(b.resolution, "done");
  assert.equal(b.unverified, false, "迁移来的不算「跳过了验证」");
  assert.equal(show("bd-c").resolution, "wontfix");
  assert.equal(show("bd-d").resolution, "duplicate");
  const c = show("bd-c");
  const createdC = c.log[0]!;
  assert.ok("args" in createdC && createdC.args["from"] === id("bd-a"), "discovered-from → created from=");
  assert.equal(show("bd-epic").created, "2026-01-02T11:04:05Z");

  assert.equal(runDoctor({ directory: d }).findings.length, 0);
  // rank 顺序 = priority 顺序
  assert.deepEqual(runLs({ directory: d, all: true, actor: ME }).tasks.map((t) => r.created.find((x) => x.id === t.id)!.beads_id),
    ["bd-b", "bd-epic", "bd-a", "bd-c", "bd-d"]);
});

test("幂等：再导入跳过已有的；新条目可以引用以前导入过的任务", () => {
  const d = repo();
  const path = beads(d, SAMPLE);
  const first = runImportBeads({ directory: d, actor: ME });
  const before = new Map(readTasks(discoverLedger(d)).map((t) => [t.idFromFilename, t.raw]));
  const again = runImportBeads({ directory: d, actor: ME });
  assert.equal(again.created.length, 0);
  assert.equal(again.skipped.already_imported, 5);
  for (const t of readTasks(discoverLedger(d))) assert.equal(t.raw, before.get(t.idFromFilename));

  writeFileSync(path, readFileSync(path, "utf8") + JSON.stringify({ id: "bd-new", title: "New", priority: 2, dependencies: [dep("bd-new", "bd-a", "blocks"), dep("bd-new", "bd-epic", "parent-child")] }) + "\n");
  const third = runImportBeads({ directory: d, actor: ME });
  assert.equal(third.created.length, 1);
  const n = runShow({ directory: d, id: third.created[0]!.id, actor: ME });
  const old = (b: string) => first.created.find((t) => t.beads_id === b)!.id;
  assert.deepEqual(n.blocked_by, [old("bd-a")]);
  assert.equal(n.parent, old("bd-epic"));
  assert.equal(runDoctor({ directory: d }).findings.length, 0);
});

test("描述里有顶格 ## 与没闭合的围栏：放进围栏，读回来一字不差，Log 没被吞掉；doctor 通过", () => {
  const d = repo();
  const desc = "Intro\n\n## Current State\n- [ ] not a criterion\n\n```go\nfunc x() {";
  beads(d, [{ id: "bd-x", title: "X", description: desc, priority: 2 }]);
  const r = runImportBeads({ directory: d, actor: ME });
  const s = runShow({ directory: d, id: r.created[0]!.id, full: true, actor: ME });
  assert.ok(s.description!.includes(desc));
  assert.deepEqual(s.acceptance, []);
  assert.equal(s.log_total, 2);
  assert.equal(runDoctor({ directory: d }).findings.length, 0);
});

test("文件：默认 .beads/issues.jsonl，也可以给路径；读不了、非 UTF-8、坏行、重复 id：退出 1，什么都不建", () => {
  const d = repo();
  assert.throws(() => runImportBeads({ directory: d, actor: ME }), code(EXIT.usage));
  beads(d, [{ id: "bd-1", title: "One" }], "elsewhere/x.jsonl");
  assert.equal(runImportBeads({ directory: d, path: join(d, "elsewhere/x.jsonl"), actor: ME }).source, "elsewhere/x.jsonl");
  const d2 = repo();
  for (const bad of ['{"id":"a","title":"A"}\nnot json\n', '[1]\n', '{"title":"no id"}\n', '{"id":"a","title":"A"}\n{"id":"a","title":"again"}\n']) {
    writeFileSync(join(d2, "b.jsonl"), bad);
    assert.throws(() => runImportBeads({ directory: d2, path: join(d2, "b.jsonl"), actor: ME }), code(EXIT.usage), bad);
  }
  writeFileSync(join(d2, "b.jsonl"), Buffer.concat([Buffer.from('{"id":"a","title":"'), Buffer.from([0xff]), Buffer.from('"}\n')]));
  assert.throws(() => runImportBeads({ directory: d2, path: join(d2, "b.jsonl"), actor: ME }), code(EXIT.usage));
  assert.equal(readTasks(discoverLedger(d2)).length, 0);
  assert.deepEqual(parseIssues('\n{"id":"a","title":"A"}\n\n', "x").map((i) => i.id), ["a"], "空行忽略");
});

test("细节：同 priority 按 created_at 再按 id；别的条目名下的依赖忽略；重复与自指的 blocks 去掉；类型与 label 重复只留一个；200 字符边界", () => {
  const issues = [
    // id 的字母序与时间顺序相反：排出来按时间才说明 created_at 真在起作用
    { id: "a-late", title: "late", priority: 1, created_at: "2026-01-05T00:00:00Z" },
    { id: "z-early", title: "early", priority: 1, created_at: "2026-01-01T00:00:00Z" },
    { id: "c", title: "c", priority: 1, created_at: "2026-01-09T00:00:00Z", issue_type: "bug", labels: ["Bug", "bug"],
      dependencies: [dep("c", "z-early", "blocks"), dep("c", "z-early", "blocks"), dep("c", "c", "blocks"), dep("other", "a-late", "blocks")] },
    { id: "e", title: "e".repeat(200), priority: 1, created_at: "2026-01-10T00:00:00Z" },
  ] as BeadsIssue[];
  const p = planBeadsImport(issues, new Set(), () => true);
  assert.deepEqual([...p.tasks].sort((a, b) => a.order - b.order).map((t) => t.beadsId), ["z-early", "a-late", "c", "e"]);
  const c = p.tasks.find((t) => t.beadsId === "c")!;
  assert.deepEqual(c.blockedBy, ["z-early"]);
  assert.deepEqual(c.labels, ["bug"]);
  const e = p.tasks.find((t) => t.beadsId === "e")!;
  assert.equal(e.title, "e".repeat(200));
  assert.equal(e.description, undefined);
});

test("created_at 在未来（时钟错了）：用导入时刻，updated 不早于 created；doctor 通过", () => {
  const d = repo();
  beads(d, [{ id: "bd-f", title: "F", priority: 2, created_at: "2999-01-01T00:00:00Z" }]);
  const r = runImportBeads({ directory: d, actor: ME });
  const s = runShow({ directory: d, id: r.created[0]!.id, actor: ME });
  assert.ok(s.created <= s.updated);
  assert.notEqual(s.created, "2999-01-01T00:00:00Z");
  assert.equal(runDoctor({ directory: d }).findings.length, 0);
});
