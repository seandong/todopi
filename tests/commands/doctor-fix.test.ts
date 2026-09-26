import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { runLs } from "../../src/commands/ls.ts";
import { runDoctor } from "../../src/commands/doctor.ts";
import { runDoctorFix, canonicalTimestamp } from "../../src/commands/doctor-fix.ts";
import { discoverLedger } from "../../src/format/discover.ts";
import { readTasks } from "../../src/format/read.ts";
import { leaseDirFor } from "../../src/format/lease.ts";
import { logEntries } from "../../src/domain/validate.ts";
import { sortTasks } from "../../src/domain/order.ts";

const ME = "me@host";
const ROOT = join(import.meta.dirname, "../..");

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-fix-"));
  runInit({ directory: d, prefix: "tp" });
  return d;
}
const taskPath = (d: string, id: string) => join(d, ".todopi", "tasks", `${id}.md`);
const read = (d: string, id: string) => readFileSync(taskPath(d, id), "utf8");
const edit = (d: string, id: string, f: (s: string) => string) => writeFileSync(taskPath(d, id), f(read(d, id)));
const fm = (d: string, id: string) => readTasks(discoverLedger(d)).find((t) => t.idFromFilename === id)!.frontmatter;
const logText = (s: string) => s.slice(s.indexOf("## Log"));

test("人手写、不加引号的文件（规格语料）：修成加引号形态，语义不变，updated 不动（规格 §6.3 例外）", () => {
  const d = repo();
  copyFileSync(join(ROOT, "spec/fixtures/valid/unquoted-hand-written.md"), taskPath(d, "tp-a1b2c3"));
  const want = JSON.parse(readFileSync(join(ROOT, "spec/fixtures/valid/unquoted-hand-written.json"), "utf8")).frontmatter;
  const r = runDoctorFix({ directory: d });
  assert.deepEqual(r.fixed.map((f) => f.path), ["tasks/tp-a1b2c3.md"]);
  const text = read(d, "tp-a1b2c3");
  assert.match(text, /^title: "A hand-written task"$/m);
  assert.match(text, /^labels: \["auth"\]$/m);
  const after = fm(d, "tp-a1b2c3");
  const { rank, ...rest } = after;
  assert.deepEqual(rest, want, "除回填的 rank 外，frontmatter 与语料的预期逐字段相同（含 updated）");
  assert.equal(typeof rank, "string");
  assert.ok(text.endsWith("Written by hand, without quotes. Still valid YAML and MUST be read.\n"), "正文原样");
  assert.equal(r.after.ok, true);
});

test("Log 一个字节都不动——包括解析不了的行与 Log 里的 [X]；只改验收标准里的 [X]；仍有问题退出码语义为 not ok", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "t", acceptance: ["one", "two"], actor: ME }).id;
  edit(d, t, (s) => s.replace("- [ ] one", "- [X] one")
    .replace(/(## Log\n\n.*\n)/, "$1- this line does not parse\n- [X] looks like a box\n"));
  const before = read(d, t);
  const r = runDoctorFix({ directory: d });
  const after = read(d, t);
  assert.equal(logText(after), logText(before), "Log 被改了");
  assert.match(after, /^- \[x\] one$/m);
  assert.deepEqual(r.fixed.map((f) => f.changes), [["1 checkbox"]]);
  assert.equal(r.after.ok, false, "解析不了的 Log 行只报告不修，修完仍有问题");
  assert.ok(r.after.findings.some((f) => /does not parse|grammar/.test(f.message)));
  assert.equal(logEntries(after).length, logEntries(before).length);
});

test("时间戳：带时区偏移或小数秒的规范成 UTC 秒级 Z（小数向下截断）；没有时区的不猜", () => {
  assert.equal(canonicalTimestamp("2026-09-14T17:00:00+08:00"), "2026-09-14T09:00:00Z");
  assert.equal(canonicalTimestamp("2026-09-14T09:00:00.999Z"), "2026-09-14T09:00:00Z");
  assert.equal(canonicalTimestamp("2026-09-14T09:00:00Z"), null, "已经规范");
  for (const bad of ["2026-09-14", "2026-09-14T09:00:00", "2026-09-14 09:00:00Z", "yesterday", 5]) assert.equal(canonicalTimestamp(bad), null, String(bad));
  const d = repo();
  const t = runAdd({ directory: d, title: "t", actor: ME }).id;
  edit(d, t, (s) => s.replace(/^created: ".*"$/m, 'created: "2026-09-14T17:00:00.5+08:00"')
    .replace(/^updated: ".*"$/m, 'updated: "2026-09-14T09:30:00Z"'));
  runDoctorFix({ directory: d });
  assert.equal(fm(d, t)["created"], "2026-09-14T09:00:00Z");
  assert.equal(fm(d, t)["updated"], "2026-09-14T09:30:00Z", "规范的 updated 不动");
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("rank 回填：按 §7.4 现有顺序排在有 rank 的之后，显示顺序不变；rank 是数字的不算缺", () => {
  const d = repo();
  const ids = ["a", "b", "c", "d", "e"].map((title) => runAdd({ directory: d, title, actor: ME }).id);
  // c、d、e 去掉 rank，并把 created 错开成与字母相反的顺序：显示顺序由 created 决定。
  ["e", "d", "c"].forEach((title, k) => {
    const id = ids["abcde".indexOf(title)]!;
    edit(d, id, (s) => s.replace(/^rank: ".*"\n/m, "").replace(/^created: ".*"$/m, `created: "2020-01-01T00:00:0${k}Z"`));
  });
  const before = runLs({ directory: d, all: true }).tasks.map((t) => t.title);
  assert.deepEqual(before, ["a", "b", "e", "d", "c"]);
  runDoctorFix({ directory: d });
  assert.deepEqual(runLs({ directory: d, all: true }).tasks.map((t) => t.title), before);
  for (const id of ids) assert.equal(typeof fm(d, id)["rank"], "string");
  // 数字 rank：那是要人看的错误，不回填。
  const n = runAdd({ directory: d, title: "n", actor: ME }).id;
  edit(d, n, (s) => s.replace(/^rank: ".*"$/m, "rank: 7"));
  const r = runDoctorFix({ directory: d });
  assert.equal(fm(d, n)["rank"], 7);
  assert.equal(r.after.ok, false);
});

test("过期租约清掉，新鲜的留着；认领本身（status / assignee）不动", () => {
  const d = repo();
  const old = runAdd({ directory: d, title: "old", actor: ME }).id;
  const fresh = runAdd({ directory: d, title: "fresh", actor: ME }).id;
  runClaim({ directory: d, id: old, actor: ME });
  runClaim({ directory: d, id: fresh, actor: ME });
  const dir = leaseDirFor(discoverLedger(d));
  const lease = JSON.parse(readFileSync(join(dir, `${old}.json`), "utf8"));
  writeFileSync(join(dir, `${old}.json`), JSON.stringify({ ...lease, heartbeat_at: "2020-01-01T00:00:00Z" }));
  const before = read(d, old);
  const r = runDoctorFix({ directory: d });
  assert.deepEqual(r.leasesCleared, [old]);
  assert.equal(existsSync(join(dir, `${old}.json`)), false);
  assert.equal(existsSync(join(dir, `${fresh}.json`)), true);
  assert.equal(read(d, old), before, "任务文件本身不动");
});

test("updated 在任何一种修复下都不变", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "t", acceptance: ["x"], actor: ME }).id;
  edit(d, t, (s) => s.replace(/^rank: ".*"\n/m, "").replace("- [ ] x", "- [X] x")
    .replace(/^title: "t"$/m, "title: t").replace(/^created: ".*"$/m, 'created: "2020-01-01T08:00:00+08:00"')
    .replace(/^updated: ".*"$/m, 'updated: "2020-01-02T00:00:00Z"'));
  const r = runDoctorFix({ directory: d });
  assert.equal(r.fixed.length, 1);
  assert.equal(fm(d, t)["updated"], "2020-01-02T00:00:00Z");
});

test("幂等：修过一遍之后再跑，什么都不改", () => {
  const d = repo();
  copyFileSync(join(ROOT, "spec/fixtures/valid/unquoted-hand-written.md"), taskPath(d, "tp-a1b2c3"));
  runDoctorFix({ directory: d });
  const once = read(d, "tp-a1b2c3");
  const r = runDoctorFix({ directory: d });
  assert.deepEqual(r.fixed, []);
  assert.equal(read(d, "tp-a1b2c3"), once);
});

test("读不出来的文件不碰，照常报告；未知键（含嵌套的 x-*）原样保留", () => {
  const d = repo();
  writeFileSync(taskPath(d, "tp-zzzzzz"), "---\ntitle: [broken\n---\n\n## Log\n");
  const broken = read(d, "tp-zzzzzz");
  const t = runAdd({ directory: d, title: "t", actor: ME }).id;
  edit(d, t, (s) => s.replace(/^---\n/, "---\nx-meta:\n  k: [1, 2]\nfuture_key: yes\n"));
  const r = runDoctorFix({ directory: d });
  assert.equal(read(d, "tp-zzzzzz"), broken);
  assert.equal(r.after.ok, false);
  assert.deepEqual(fm(d, t)["x-meta"], { k: [1, 2] });
  assert.equal(fm(d, t)["future_key"], "yes", "YAML 1.2：yes 是字符串，原样保留");
});

test("非规范的 updated 连写法都不动（§6.3：修复 MUST NOT 改 updated），照常报告（评审一轮）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "t", actor: ME }).id;
  edit(d, t, (s) => s.replace(/^created: ".*"$/m, 'created: "2020-01-01T00:00:00Z"')
    .replace(/^updated: ".*"$/m, 'updated: "2020-01-02T08:00:00+08:00"'));
  const r = runDoctorFix({ directory: d });
  assert.equal(fm(d, t)["updated"], "2020-01-02T08:00:00+08:00");
  assert.equal(r.after.ok, false);
  assert.ok(r.after.findings.some((f) => /updated must be an RFC 3339/.test(f.message)));
});

test("文件里有非法 UTF-8 字节：不重写（重写会把它们换成 U+FFFD，Log 就不是原来的字节了）（评审一轮）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "t", actor: ME }).id;
  edit(d, t, (s) => s.replace(/^rank: ".*"\n/m, ""));
  const p = taskPath(d, t);
  const bytes = Buffer.concat([readFileSync(p), Buffer.from([0x2d, 0x20, 0x62, 0x61, 0x64, 0x20, 0xff, 0x0a])]);
  writeFileSync(p, bytes);
  const r = runDoctorFix({ directory: d });
  assert.ok(readFileSync(p).equals(bytes), "文件字节变了");
  // 它缺 rank 又写不了：回填整体撤掉，也报一条。
  assert.deepEqual(r.skipped.map((s) => s.path), ["(rank backfill)", `tasks/${t}.md`]);
  assert.match(r.skipped[1]!.reason, /not valid UTF-8/);
});

test("无 rank 段里有回填不了的任务（rank 是数字、文件读不出来）：整体不回填，顺序不变，报告原因（评审一轮）", () => {
  for (const blocker of ["numeric", "broken"] as const) {
    const d = repo();
    const ranked = runAdd({ directory: d, title: "ranked", actor: ME }).id;
    const odd = runAdd({ directory: d, title: "odd", actor: ME }).id;
    const missing = runAdd({ directory: d, title: "missing", actor: ME }).id;
    void ranked;
    edit(d, odd, (s) => blocker === "numeric" ? s.replace(/^rank: ".*"$/m, "rank: 7").replace(/^created: ".*"$/m, 'created: "2020-01-02T00:00:00Z"')
      : "---\ntitle: [broken\n---\n");
    edit(d, missing, (s) => s.replace(/^rank: ".*"\n/m, "").replace(/^created: ".*"$/m, 'created: "2020-01-03T00:00:00Z"'));
    const order = () => sortTasks(readTasks(discoverLedger(d))).map((t) => t.idFromFilename);
    const before = order();
    const r = runDoctorFix({ directory: d });
    assert.deepEqual(order(), before, blocker);
    assert.equal("rank" in fm(d, missing), false, `${blocker}：不该回填`);
    assert.ok(r.skipped.some((s) => s.path === "(rank backfill)" && s.reason.includes(`tasks/${odd}.md`)), blocker);
  }
});

test("形状对但日期不存在（2 月 30 日）：不规范化——那是猜，不是换个写法（评审一轮）", () => {
  assert.equal(canonicalTimestamp("2026-02-30T12:34:56+00:00"), null);
  assert.equal(canonicalTimestamp("2026-02-28T24:00:00+00:00"), null);
  assert.equal(canonicalTimestamp("2026-02-28T12:00:00+25:00"), null);
  assert.equal(canonicalTimestamp("2024-02-29T12:00:00+00:00"), "2024-02-29T12:00:00Z", "闰日是真的");
});

test("未知键给警告、不让 doctor 失败；x- 扩展键不警告", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "t", actor: ME }).id;
  edit(d, t, (s) => s.replace(/^---\n/, "---\nfuture_key: \"hi\"\nx-ours: \"ok\"\n"));
  const r = runDoctor({ directory: d });
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings.map((w) => [w.rule, w.path]), [["unknown-key", `tasks/${t}.md`]]);
  assert.match(r.warnings[0]!.message, /"future_key"/);
});

test("updated 那一行保留原文：不加引号的照样不加（D034：换个写法也是改）（评审二轮）", () => {
  const d = repo();
  copyFileSync(join(ROOT, "spec/fixtures/valid/unquoted-hand-written.md"), taskPath(d, "tp-a1b2c3"));
  runDoctorFix({ directory: d });
  const text = read(d, "tp-a1b2c3");
  assert.match(text, /^updated: 2026-09-14T09:00:00Z$/m, "updated 的原文变了");
  assert.match(text, /^created: "2026-09-14T09:00:00Z"$/m, "created 照常规范成加引号形态");
});

test("排在前面的缺 rank 任务写不了（非法 UTF-8）：整体不回填，顺序不变；doctor 报非法 UTF-8、退出不为 ok（评审二轮）", () => {
  const d = repo();
  const early = runAdd({ directory: d, title: "early", actor: ME }).id;
  const late = runAdd({ directory: d, title: "late", actor: ME }).id;
  edit(d, early, (s) => s.replace(/^rank: ".*"\n/m, "").replace(/^created: ".*"$/m, 'created: "2020-01-01T00:00:00Z"'));
  edit(d, late, (s) => s.replace(/^rank: ".*"\n/m, "").replace(/^created: ".*"$/m, 'created: "2020-01-02T00:00:00Z"'));
  const p = taskPath(d, early);
  writeFileSync(p, Buffer.concat([readFileSync(p), Buffer.from([0xff, 0x0a])]));
  const order = () => sortTasks(readTasks(discoverLedger(d))).map((t) => t.idFromFilename);
  const before = order();
  const r = runDoctorFix({ directory: d });
  assert.deepEqual(order(), before);
  assert.equal("rank" in fm(d, late), false, "late 不该单独回填");
  assert.ok(r.skipped.some((s) => s.path === "(rank backfill)"));
  assert.equal(r.after.ok, false);
  assert.ok(r.after.findings.some((f) => f.path === `tasks/${early}.md` && /not valid UTF-8/.test(f.message)));
});
