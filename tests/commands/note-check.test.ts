import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { runNote } from "../../src/commands/note.ts";
import { runCheck, parseCriterionNumber } from "../../src/commands/check.ts";
import { runShow } from "../../src/commands/show.ts";
import { runDoctor } from "../../src/commands/doctor.ts";
import { discoverLedger } from "../../src/format/discover.ts";
import { readLease, writeLease } from "../../src/format/lease.ts";
import { logEntries } from "../../src/domain/validate.ts";
import { EXIT, CliError } from "../../src/exit.ts";

const ME = "me@host";
const OTHER = "other@host";
const OLD = "2020-01-01T00:00:00Z";

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-worklog-"));
  runInit({ directory: d, prefix: "tp" });
  return d;
}
const taskPath = (d: string, id: string) => join(d, ".todopi", "tasks", `${id}.md`);
const read = (d: string, id: string) => readFileSync(taskPath(d, id), "utf8");
const edit = (d: string, id: string, f: (s: string) => string) => writeFileSync(taskPath(d, id), f(read(d, id)));
const bodyOf = (d: string, id: string) => read(d, id).split(/^---$/m).slice(2).join("---");
const entries = (d: string, id: string) => logEntries(bodyOf(d, id));
const updatedOf = (d: string, id: string) => /^updated: "(.*)"$/m.exec(read(d, id))![1];
const code = (c: number) => (e: unknown) => e instanceof CliError && e.code === c;

/** 把 updated 拨回很久以前，好看出这次写入有没有刷新它。 */
const ageUpdated = (d: string, id: string) => edit(d, id, (s) => s.replace(/^updated: ".*"$/m, `updated: "${OLD}"`));

// ── note ─────────────────────────────────────────────────────────────────

test("note 追加一行、刷新 updated", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  ageUpdated(d, t.id);
  runNote({ directory: d, id: t.id, text: "learned a thing", actor: ME });
  const last = entries(d, t.id).at(-1)!;
  assert.match(last.head, /^- \S+Z me@host note: learned a thing$/);
  assert.notEqual(updatedOf(d, t.id), OLD, "spec §6.3：每次写入都刷新 updated");
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("note 多行：续行缩进两格，正文里的空行不会把这一条截断", () => {
  // 真空行会让读者（logEntries）提前结束这一条；写入端必须写成两个空格。
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  runNote({ directory: d, id: t.id, text: "first\n\nthird\r\n- looks like an item", actor: ME });
  const e = entries(d, t.id);
  assert.equal(e.length, 2, "空行把这一条截断了，或者续行变成了新条目");
  assert.deepEqual(e[1]!.continuation, ["", "third", "- looks like an item"]);
  const shown = runShow({ directory: d, id: t.id }).log.at(-1)!;
  assert.equal("text" in shown ? shown.text : undefined, "first\n\nthird\n- looks like an item");
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("note 的正文长得像 key=value 也没事 —— 它在冒号之后", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  runNote({ directory: d, id: t.id, text: "verify=pass commit=deadbee is what it said", actor: ME });
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("空白的 note 拒绝，文件不动", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  const before = read(d, t.id);
  assert.throws(() => runNote({ directory: d, id: t.id, text: " \n\t\n ", actor: ME }), code(EXIT.usage));
  assert.equal(read(d, t.id), before);
});

// ── 归属（FR-C6：写入严格匹配）──────────────────────────────────────────

test("任务在别人手里：note 与 check 都退出 3，文件不动", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", acceptance: ["a"], actor: ME });
  runClaim({ directory: d, id: t.id, actor: OTHER });
  const before = read(d, t.id);
  assert.throws(() => runNote({ directory: d, id: t.id, text: "x", actor: ME }), code(EXIT.conflict));
  assert.throws(() => runCheck({ directory: d, id: t.id, n: 1, actor: ME }), code(EXIT.conflict));
  assert.equal(read(d, t.id), before);
});

test("文件里没人持有、但共享租约活着且属于别人：照样退出 3", () => {
  // 租约跨 worktree 共享而任务文件不共享——本树的文件说「没人拿」完全可能是过期视图。
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  writeLease(discoverLedger(d), t.id, { actor: OTHER, claimed_at: now, heartbeat_at: now });
  assert.throws(() => runNote({ directory: d, id: t.id, text: "x", actor: ME }), code(EXIT.conflict));
});

test("别人的租约已经过期：不挡（spec §8），也**不替它刷新心跳**", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  const ledger = discoverLedger(d);
  writeLease(ledger, t.id, { actor: OTHER, claimed_at: OLD, heartbeat_at: OLD });
  runNote({ directory: d, id: t.id, text: "x", actor: ME });
  assert.equal(readLease(ledger, t.id)!.heartbeat_at, OLD, "替别人刷新了心跳——等于给了对方一段没在用的独占");
});

test("已关闭任务：文件里的 assignee 是历史记录，不算持有者 —— note 允许", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  edit(d, t.id, (s) => s.replace(/^status: "open"$/m, `status: "closed"\nresolution: "done"\nassignee: "${OTHER}"`));
  runNote({ directory: d, id: t.id, text: "a lesson after the fact", actor: ME });
  assert.match(entries(d, t.id).at(-1)!.head, /note: a lesson after the fact$/);
});

// ── 心跳（FR-C3）──────────────────────────────────────────────────────────

test("持有者写入刷新自己的心跳；没有租约时不凭空造一份", () => {
  const d = repo();
  const ledger = discoverLedger(d);
  const mine = runAdd({ directory: d, title: "mine", acceptance: ["a"], actor: ME });
  runClaim({ directory: d, id: mine.id, actor: ME });
  const lease = readLease(ledger, mine.id)!;
  writeLease(ledger, mine.id, { ...lease, heartbeat_at: OLD });
  runNote({ directory: d, id: mine.id, text: "x", actor: ME });
  assert.notEqual(readLease(ledger, mine.id)!.heartbeat_at, OLD, "note 没刷新持有者的心跳");
  writeLease(ledger, mine.id, { ...lease, heartbeat_at: OLD });
  runCheck({ directory: d, id: mine.id, n: 1, actor: ME });
  assert.notEqual(readLease(ledger, mine.id)!.heartbeat_at, OLD, "check 没刷新持有者的心跳");

  const loose = runAdd({ directory: d, title: "loose", actor: ME });
  runNote({ directory: d, id: loose.id, text: "x", actor: ME });
  assert.equal(readLease(ledger, loose.id), null, "没有租约的任务被写出了一份租约");
});

// ── check ───────────────────────────────────────────────────────────────

function criteriaTask(d: string): string {
  const t = runAdd({ directory: d, title: "T", acceptance: ["one", "two", "three"], actor: ME });
  // 在第 1、2 条之间插一个嵌套项：它不是标准，不占编号，也不能被翻
  edit(d, t.id, (s) => s.replace("- [ ] one\n", "- [ ] one\n  - [ ] nested\n"));
  return t.id;
}

test("check 2：翻的是第 2 条（嵌套项不占编号），只动那一行，记 check ac=2", () => {
  const d = repo();
  const id = criteriaTask(d);
  ageUpdated(d, id);
  const before = read(d, id).split("\n");
  const r = runCheck({ directory: d, id, n: 2, actor: ME });
  assert.deepEqual(r, { id, n: 2, text: "two", checked: true, changed: true });
  // 追加的那一行 Log 会让它之后的行号错开一位；先摘掉它，再逐行比。
  const after = read(d, id).split("\n").filter((l) => !/ check ac=2: two$/.test(l));
  assert.equal(after.length, before.length);
  const changed = before.map((l, i) => [l, after[i]]).filter(([a, b]) => a !== b && !a!.startsWith("updated:"));
  assert.deepEqual(changed, [["- [ ] two", "- [x] two"]], "只该翻恰好那一行");
  assert.match(entries(d, id).at(-1)!.head, /^- \S+Z me@host check ac=2: two$/);
  assert.notEqual(updatedOf(d, id), OLD);
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("check --undo：清掉大写 X，记 uncheck", () => {
  const d = repo();
  const id = criteriaTask(d);
  edit(d, id, (s) => s.replace("- [ ] three", "- [X] three"));
  const r = runCheck({ directory: d, id, n: 3, undo: true, actor: ME });
  assert.equal(r.changed, true);
  assert.match(read(d, id), /^- \[ \] three$/m);
  assert.match(entries(d, id).at(-1)!.head, / uncheck ac=3: three$/);
});

test("幂等：已勾再 check、未勾再 --undo，退出 0、不写文件、不记 Log", () => {
  const d = repo();
  const id = criteriaTask(d);
  runCheck({ directory: d, id, n: 1, actor: ME });
  const before = read(d, id);
  const again = runCheck({ directory: d, id, n: 1, actor: ME });
  assert.equal(again.changed, false);
  const undoOpen = runCheck({ directory: d, id, n: 2, undo: true, actor: ME });
  assert.equal(undoOpen.changed, false);
  assert.equal(read(d, id), before, "空操作也写了文件");
});

test("编号越界、没有标准：退出 1，文件不动", () => {
  const d = repo();
  const id = criteriaTask(d);
  const before = read(d, id);
  assert.throws(() => runCheck({ directory: d, id, n: 4, actor: ME }),
    (e: unknown) => code(EXIT.usage)(e) && /has 3 acceptance criteria; there is no #4/.test((e as Error).message));
  assert.equal(read(d, id), before);
  const bare = runAdd({ directory: d, title: "bare", actor: ME });
  assert.throws(() => runCheck({ directory: d, id: bare.id, n: 1, actor: ME }), code(EXIT.usage));
});

test("已关闭任务不能改勾选：退出 2，指向 reopen，文件不动", () => {
  // done 的验收门禁是按关闭那一刻的勾选状态放行的；事后翻转等于改写那份证据。
  const d = repo();
  const id = criteriaTask(d);
  edit(d, id, (s) => s.replace(/^status: "open"$/m, 'status: "closed"\nresolution: "done"'));
  const before = read(d, id);
  assert.throws(() => runCheck({ directory: d, id, n: 1, actor: ME }),
    (e: unknown) => code(EXIT.gate)(e) && /todopi reopen/.test((e as Error).message));
  assert.equal(read(d, id), before);
});

test("Log 里记的是当时的标准文本，截断到 80 字符（spec §5.3.3）", () => {
  const d = repo();
  const long = "x".repeat(79) + "YZ";                          // 81 个字符
  const t = runAdd({ directory: d, title: "T", acceptance: [long], actor: ME });
  runCheck({ directory: d, id: t.id, n: 1, actor: ME });
  const head = entries(d, t.id).at(-1)!.head;
  assert.ok(head.endsWith(`: ${"x".repeat(79)}Y`), head);
});

test("parseCriterionNumber 从字符串出发：拒绝 0、1.5、0x2、空串", () => {
  // F04 的教训：Number.parseInt 会把 "1.5" 读成 1、"0x2" 读成 0。
  assert.equal(parseCriterionNumber("2"), 2);
  for (const bad of ["0", "1.5", "0x2", "", "-1", "2a", " 2"]) {
    assert.throws(() => parseCriterionNumber(bad), code(EXIT.usage), bad);
  }
});

// ── 评审第一轮：写入端与读取端对「哪一段是 Log」「哪一行是标准」必须一致 ──────

test("缩进的 `   ## Log` 不是 Log 标题 —— note 不能把事件写进读者看不见的地方", () => {
  // 写入端曾用 .trim() 找标题，读取端要求顶格精确匹配（spec §5.3：exactly）。
  // 于是事件被追加进一段未识别正文里：note 成功、doctor 通过，show 却一条都看不见。
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  edit(d, t.id, (s) => s.replace(/^## Log$/m, "   ## Log"));
  runNote({ directory: d, id: t.id, text: "must be visible", actor: ME });
  const r = runShow({ directory: d, id: t.id, full: true });
  assert.ok(r.log.some((e) => "text" in e && e.text === "must be visible"), "写进去的事件读不回来");
  assert.ok(read(d, t.id).includes("   ## Log"), "那段未识别正文必须原样保留");
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("`- [ ]x`（方括号后没有空白）不是标准：不占编号，check 也不会改写它", () => {
  // GFM 任务项的标记后必须跟空白。旧的解析把空格当可选，于是这行成了第 1 条标准——
  // 改变编号、挡住 done，而 F09 的 check 会真的去改写它。
  const d = repo();
  const t = runAdd({ directory: d, title: "T", acceptance: ["real"], actor: ME });
  edit(d, t.id, (s) => s.replace("- [ ] real", "- [ ]x not a task item\n- [ ] real"));
  const r = runCheck({ directory: d, id: t.id, n: 1, actor: ME });
  assert.equal(r.text, "real", "第 1 条应当是真正的那条标准");
  assert.match(read(d, t.id), /^- \[ \]x not a task item$/m, "非标准行被改写了");
});

test("新建 Log 小节时，原正文逐字节保留 —— 末尾未识别小节的尾随空白也不能削", () => {
  // 找不到真正的 `## Log` 时要在末尾新建一节。第一版先 `replace(/\s*$/, "")` 再拼，
  // 于是末尾 `## Repair` 里的两个尾随空格和空行都没了（评审实测）；doctor 照样通过。
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  const tails = ["## Repair\nkeep  \n\n", "## Repair\nno trailing newline", "## Repair\nkeep\n"];
  for (const tail of tails) {
    edit(d, t.id, (s) => {
      const [, fm] = s.split(/^---$/m);
      return `---${fm}---\n\n${tail}`;
    });
    const before = bodyOf(d, t.id);
    runNote({ directory: d, id: t.id, text: "x", actor: ME });
    const after = bodyOf(d, t.id);
    assert.ok(after.startsWith(before), `原正文没有逐字节保留：\n${JSON.stringify(before)}\n→\n${JSON.stringify(after)}`);
    assert.match(after.slice(before.length), /(^|\n)## Log\n/, "新的小节没有落成顶格标题");
    assert.equal(runShow({ directory: d, id: t.id }).log_total, 1, "新建的 Log 读不回来");
  }
});
