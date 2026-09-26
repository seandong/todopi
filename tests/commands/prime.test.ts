import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { runCheck } from "../../src/commands/check.ts";
import { runNote } from "../../src/commands/note.ts";
import { runDep } from "../../src/commands/dep.ts";
import { runPrime, runPrimeFull, parseBudget } from "../../src/commands/prime.ts";
import { renderPrime, renderPrimeFull } from "../../src/output/render/prime.ts";
import { discoverLedger } from "../../src/format/discover.ts";
import { readLastPrime } from "../../src/format/session.ts";
import { leaseDirFor } from "../../src/format/lease.ts";
import { EXIT, CliError } from "../../src/exit.ts";

const ME = "me@host";
const OTHER = "other@elsewhere";

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-prime-"));
  runInit({ directory: d, prefix: "tp" });
  return d;
}
const taskPath = (d: string, id: string) => join(d, ".todopi", "tasks", `${id}.md`);
const edit = (d: string, id: string, f: (s: string) => string) => writeFileSync(taskPath(d, id), f(readFileSync(taskPath(d, id), "utf8")));
const prime = (d: string, budget?: number) => runPrime({ directory: d, actor: ME, budget }).report;
const text = (d: string, budget?: number) => renderPrime(prime(d, budget));

/**
 * D010：协议不进 prime。用**白名单**断言——每一行都是认得的几种之一。列一份 AGENTS.md 里的
 * 句子做黑名单证明不了什么：换一句就漏了。
 */
const LINE_KINDS = [
  /^## tp-[0-9a-z]+: /, /^Acceptance criteria[ :(]/, /^- \[[ x]\] \d+\. /, /^Recent log:$/,
  /^- \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ /, /^ {2}/, /^\+ \d+ more tasks? you hold: /, /^$/,
];
function assertShape(out: string): void {
  assert.ok(out.endsWith("\n") && !out.endsWith("\n\n"), "结尾恰好一个换行");
  assert.doesNotMatch(out, /\x1b/, "没有 ANSI 颜色——这段文字是注入进模型上下文的");
  const lines = out.slice(0, -1).split("\n");
  const last = lines.pop()!;
  assert.match(last, /^(\d+ ready \(`todopi ls --ready`\)|No task in progress · \d+ ready)/, "最后一行是指针");
  for (const l of lines) assert.ok(LINE_KINDS.some((re) => re.test(l)), `不认得的一行：${JSON.stringify(l)}`);
}

test("没有进行中的任务：退化为单行，给可领数与命令", () => {
  const d = repo();
  runAdd({ directory: d, title: "a", actor: ME });
  const b = runAdd({ directory: d, title: "b", actor: ME }).id;
  runAdd({ directory: d, title: "c", blockedBy: [b], actor: ME });
  const out = text(d);
  assert.equal(out, "No task in progress · 2 ready: `todopi ls --ready`\n", "被挡住的 c 不算可领");
});

test("持有任务：标题、带状态与编号的验收标准、最近 2 条 Log、末尾指针", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "the task", acceptance: ["first", "second"], actor: ME }).id;
  runAdd({ directory: d, title: "other", actor: ME });
  runClaim({ directory: d, id: t, actor: ME });
  runCheck({ directory: d, id: t, n: 1, actor: ME });
  runNote({ directory: d, id: t, text: "line one\nline two", actor: ME });
  const out = text(d);
  assertShape(out);
  assert.match(out, new RegExp(`^## ${t}: the task\n`));
  assert.match(out, /Acceptance criteria \(1 of 2 checked\):\n- \[x\] 1\. first\n- \[ \] 2\. second\n/);
  assert.match(out, /Recent log:\n- \S+ me@host check ac=1: first\n- \S+ me@host note: line one\n {2}line two\n/);
  assert.doesNotMatch(out, / created\n/, "只推最近 2 条");
  assert.match(out, /\n1 ready \(`todopi ls --ready`\) · everything else: `todopi prime --full`\n$/);
});

test("别人持有的计数；同一台机器上别的 agent 持有的算我的（FR-C6 宽松匹配）", () => {
  const d = repo();
  const a = runAdd({ directory: d, title: "a", actor: ME }).id;
  const b = runAdd({ directory: d, title: "b", actor: ME }).id;
  const c = runAdd({ directory: d, title: "c", actor: ME }).id;
  runClaim({ directory: d, id: a, actor: OTHER });
  runClaim({ directory: d, id: b, actor: `claude-code@${hostname()}` });
  runClaim({ directory: d, id: c, actor: ME });
  const r = prime(d, 5000);
  assert.equal(r.heldByOthers, 1);
  assert.deepEqual(r.held.map((t) => t.id).sort(), [b, c].sort());
});

/** 一个有 3 条已勾、2 条未勾标准，和 6 条 Log 的持有任务。 */
function bigTask(d: string, title = "big"): string {
  const t = runAdd({ directory: d, title, acceptance: ["c1 checked", "c2 checked", "c3 checked", "u4 still open", "u5 still open"], actor: ME }).id;
  runClaim({ directory: d, id: t, actor: ME });
  for (const n of [1, 2, 3]) runCheck({ directory: d, id: t, n, actor: ME });
  runNote({ directory: d, id: t, text: "a fairly long note ".repeat(8), actor: ME });
  return t;
}

test("裁剪顺序：先丢已勾的标准，再把 Log 减到 1 条；未勾的永不丢；指针对每个预算都是最后一行", () => {
  const d = repo();
  bigTask(d);
  let sawLevel1 = false, sawLevel2 = false;
  for (let budget = 800; budget >= 0; budget--) {
    const r = prime(d, budget);
    const out = renderPrime(r);
    assertShape(out);
    const [t] = r.held;
    assert.ok(t, `预算 ${budget}：持有的任务必须在`);
    assert.deepEqual(t.acceptance.filter((c) => !c.checked).map((c) => c.text), ["u4 still open", "u5 still open"],
      `预算 ${budget}：未勾的标准被丢了`);
    // 顺序：Log 只剩 1 条时，已勾的必然已经全丢了。
    if (t.log.length === 1) assert.equal(t.checkedOmitted, 3, `预算 ${budget}：先减了 Log 才丢已勾的标准`);
    if (t.checkedOmitted > 0 && t.log.length === 2) sawLevel1 = true;
    if (t.log.length === 1) sawLevel2 = true;
    assert.equal(r.truncated, t.checkedOmitted > 0, `预算 ${budget}：truncated 与实际不符`);
  }
  assert.ok(sawLevel1 && sawLevel2, "两级截断都应在这个预算区间里出现过");
});

test("收紧到底仍超预算：照样输出第一个任务（它的未勾标准正是推送的意义）", () => {
  const d = repo();
  const t = bigTask(d);
  const r = prime(d, 0);
  assert.equal(r.held[0]!.id, t);
  assert.equal(r.truncated, true);
  assert.equal(r.held[0]!.log.length, 1);
});

test("持有多个：按 updated 由新到旧；装不下的从旧的一端退化为一行计数", () => {
  const d = repo();
  const ids = ["old", "mid", "new"].map((title) => bigTask(d, title));
  // updated 精确到秒，同一秒里建的三个无法区分新旧——显式错开。
  ids.forEach((id, k) => edit(d, id, (s) => s.replace(/^updated: ".*"$/m, `updated: "2026-09-26T00:00:0${k}Z"`)));
  const roomy = prime(d, 5000);
  assert.deepEqual(roomy.held.map((t) => t.title), ["new", "mid", "old"]);
  assert.equal(roomy.moreHeld, 0);
  const tight = prime(d, 120);
  assert.equal(tight.held[0]!.title, "new");
  assert.ok(tight.moreHeld >= 1);
  assert.equal(tight.held.length + tight.moreHeld, 3);
  const out = renderPrime(tight);
  assertShape(out);
  assert.match(out, new RegExp(`\\+ ${tight.moreHeld} more tasks? you hold: \`todopi ls --mine\`\n\n`));
});

test("只有散文判据的任务：说明没有勾选项，并指向 show", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "prose", actor: ME }).id;
  runClaim({ directory: d, id: t, actor: ME });
  const out = text(d);
  assertShape(out);
  assert.match(out, new RegExp(`Acceptance criteria: none as checkboxes \\(see \`todopi show ${t}\`\\)\n`));
});

test("账本里有解析失败的文件：prime 不崩，照常输出", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "fine", acceptance: ["x"], actor: ME }).id;
  runClaim({ directory: d, id: t, actor: ME });
  writeFileSync(join(d, ".todopi", "tasks", "tp-broken.md"), "---\nnot: [valid\n---\n");
  assertShape(text(d));
});

test("FR-P1b：按会话记录时间；没给会话就按 actor；两者互不覆盖", () => {
  const d = repo();
  const ledger = discoverLedger(d);
  runPrime({ directory: d, actor: ME, session: "abc/../weird id" });
  assert.match(readLastPrime(ledger, { session: "abc/../weird id" }) ?? "", /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(readLastPrime(ledger, { actor: ME }), null);
  runPrime({ directory: d, actor: ME });
  assert.notEqual(readLastPrime(ledger, { actor: ME }), null);
  assert.equal(readLastPrime(ledger, { session: "other" }), null);
});

test("会话时间写不进去：输出照常，只多一条警告（它跑在会话开始的钩子里）", () => {
  const d = repo();
  const ledger = discoverLedger(d);
  const sessions = join(leaseDirFor(ledger), "sessions");
  rmSync(sessions, { recursive: true, force: true });
  mkdirSync(join(sessions, ".."), { recursive: true });
  writeFileSync(sessions, "not a directory");
  const r = runPrime({ directory: d, actor: ME });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0]!, /Could not record/);
  assert.match(renderPrime(r.report), /^No task in progress/);
});

test("--full：各节按 FR-P3，不受预算约束", () => {
  const d = repo();
  const mine = bigTask(d, "mine");
  const theirs = runAdd({ directory: d, title: "theirs", actor: ME }).id;
  runClaim({ directory: d, id: theirs, actor: OTHER });
  const readyIds = [1, 2, 3, 4, 5, 6].map((k) => runAdd({ directory: d, title: `r${k}`, actor: ME }).id);
  const blocker = readyIds[0]!;
  runDep({ directory: d, op: "add", id: readyIds[5]!, on: blocker, actor: ME });
  for (const k of [1, 2, 3, 4]) {
    const id = runAdd({ directory: d, title: `closed${k}`, actor: ME }).id;
    edit(d, id, (s) => s.replace(/^status: "open"$/m, 'status: "closed"\nresolution: "done"')
      .replace(/^updated: ".*"$/m, `updated: "2026-09-26T00:00:0${k}Z"`));
  }
  const { report } = runPrimeFull({ directory: d, actor: ME });
  assert.deepEqual(report.held.map((t) => t.id), [mine]);
  assert.equal(report.held[0]!.checkedOmitted, 0, "全景不截断");
  assert.deepEqual(report.heldByOthers.map((t) => [t.id, t.assignee]), [[theirs, OTHER]]);
  assert.equal(report.ready.length, 5);
  assert.equal(report.readyTotal, 5, "被挡住的 r6 不算");
  assert.deepEqual(report.counts, { open: 6, in_progress: 2, ready: 5, blocked: 1, closed: 4 });
  assert.deepEqual(report.recentlyClosed.map((t) => t.title), ["closed4", "closed3", "closed2"]);
  const out = renderPrimeFull(report);
  for (const h of ["# In progress (yours)", "# Held by others", "# Ready", "# Counts", "# Recently closed"]) assert.ok(out.includes(`${h}\n`), h);
});

test("parseBudget 从字符串出发：拒绝 0x10、1.5、1e3、负数、空串", () => {
  assert.equal(parseBudget("0"), 0);
  assert.equal(parseBudget("600"), 600);
  for (const bad of ["0x10", "1.5", "1e3", "-1", "", " 5", "05"]) {
    assert.throws(() => parseBudget(bad), (e: unknown) => e instanceof CliError && e.code === EXIT.usage, bad);
  }
});
