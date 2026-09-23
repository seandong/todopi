import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { runLs } from "../../src/commands/ls.ts";
import { runDoctor } from "../../src/commands/doctor.ts";
import { runDone } from "../../src/commands/done.ts";
import { runClose } from "../../src/commands/close.ts";
import { runReopen } from "../../src/commands/reopen.ts";
import { GateRefused } from "../../src/commands/transition.ts";
import { discoverLedger } from "../../src/format/discover.ts";
import { readLease, leaseDirFor, writeLease } from "../../src/format/lease.ts";
import { parseLogLine, logLines } from "../../src/domain/validate.ts";
import { EXIT } from "../../src/exit.ts";

const ME = "me@host";
const OTHER = "other@host";

function repo(opts: { git?: boolean } = {}): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-trans-"));
  if (opts.git) {
    execFileSync("git", ["init", "-q"], { cwd: d, stdio: "ignore" });
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], {
      cwd: d, stdio: "ignore",
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e",
             GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e" },
    });
  }
  runInit({ directory: d, prefix: "tp" });
  return d;
}
const taskPath = (d: string, id: string) => join(d, ".todopi", "tasks", `${id}.md`);
const read = (d: string, id: string) => readFileSync(taskPath(d, id), "utf8");
const logsOf = (d: string, id: string) =>
  logLines(read(d, id).split("---\n").slice(2).join("---\n")).map(parseLogLine);
const refusal = (code: number) => (e: unknown) => e instanceof GateRefused && e.code === code;

// ---- 四道门禁 ----

test("未勾的验收标准 → 拒绝，退出 2，报告逐条列出", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", acceptance: ["first thing", "second thing"], actor: ME });
  try {
    runDone({ directory: d, id: t.id, actor: ME });
    assert.fail("应当被拒绝");
  } catch (e) {
    assert.ok(refusal(EXIT.gate)(e));
    const r = (e as GateRefused).report.refused[0]!;
    assert.equal(r.gate, "acceptance");
    assert.deepEqual(r.gate === "acceptance" ? r.unchecked.map((c) => c.text) : null,
      ["first thing", "second thing"]);
  }
});

test("未关闭的子任务 → 拒绝，退出 2", () => {
  const d = repo();
  const parent = runAdd({ directory: d, title: "parent", actor: ME });
  const kid = runAdd({ directory: d, title: "kid", parent: parent.id, actor: ME });
  assert.throws(() => runDone({ directory: d, id: parent.id, actor: ME }), refusal(EXIT.gate));
  runDone({ directory: d, id: kid.id, actor: ME });
  assert.doesNotThrow(() => runDone({ directory: d, id: parent.id, actor: ME }));
});

test("别人持有 → 拒绝，退出 3", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  runClaim({ directory: d, id: t.id, actor: OTHER });
  assert.throws(() => runDone({ directory: d, id: t.id, actor: ME }), refusal(EXIT.conflict));
});

test("共享租约属于别人 → 三条命令都拒绝（D019 的边界）", () => {
  // 这条用例原先标题写「三条命令」，循环里却只有 done 与 close——
  // reopen 因此带着缺陷溜过去了：它提前返回、跳过租约检查，却照样删租约。
  // Codex 评审用真实双 worktree 复现了后果，并且是**读我的测试**发现标题
  // 与内容对不上的。「看起来在测 X、实际只测了 Y」又一次。
  const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  for (const [name, prepare, run] of [
    ["done", null,
      (d: string, id: string) => runDone({ directory: d, id, actor: ME })],
    ["close", null,
      (d: string, id: string) => runClose({ directory: d, id, actor: ME, resolution: "wontfix" })],
    // reopen 的起点必须是 closed，所以先关掉它
    ["reopen", (d: string, id: string) => { runDone({ directory: d, id, actor: ME }); },
      (d: string, id: string) => runReopen({ directory: d, id, actor: ME })],
  ] as const) {
    const d = repo();
    const t = runAdd({ directory: d, title: "T", actor: ME });
    runClaim({ directory: d, id: t.id, actor: ME });
    prepare?.(d, t.id);
    writeLease(discoverLedger(d), t.id, { actor: OTHER, claimed_at: now(), heartbeat_at: now() });

    assert.throws(() => run(d, t.id), refusal(EXIT.conflict), `${name} 应当被共享租约挡住`);
    assert.equal(readLease(discoverLedger(d), t.id)?.actor, OTHER, `${name} 不得删掉别人的活租约`);
  }
});

test("--force 越不过状态门禁 —— 已关闭的任务不能再 done 一次", () => {
  // spec §6.1：--force 覆盖的是对「是否就绪」的判断，不是状态机。
  // 表格里没有 closed → closed 这一行。放行的话会写出第二条 done 日志，
  // 随后还能被 close --force 改掉 resolution（Codex 评审实测复现）。
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  runDone({ directory: d, id: t.id, actor: ME });
  const before = read(d, t.id);

  assert.throws(() => runDone({ directory: d, id: t.id, actor: ME, force: true, reason: "again" }),
    refusal(EXIT.gate));
  assert.throws(() => runClose({ directory: d, id: t.id, actor: ME, resolution: "wontfix",
    force: true, reason: "rewrite" }), refusal(EXIT.gate));
  assert.equal(read(d, t.id), before, "被拒绝的强制迁移同样什么都不改");
  assert.equal(logsOf(d, t.id).filter((l) => l.ok && l.verb === "done").length, 1,
    "只该有一条 done 日志");
});

test("--force 越不过状态门禁 —— 未关闭的任务不能 reopen", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  assert.throws(() => runReopen({ directory: d, id: t.id, actor: ME, force: true, reason: "x" }),
    refusal(EXIT.gate));
});

test("close 不查验收标准 —— 取消一个半截的任务不必强制", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", acceptance: ["never finished"], actor: ME });
  assert.doesNotThrow(() => runClose({ directory: d, id: t.id, actor: ME, resolution: "wontfix" }));
  // 而且它不该被标成 unverified —— 那个标记是留给「跳过了验证的完成」的
  assert.equal(runLs({ directory: d, closed: true }).tasks.find((x) => x.id === t.id)?.unverified,
    false, "正常取消的任务不是未验证");
});

test("CRLF 正文不会让验收标准被当成空集", () => {
  // §5.1 要求 LF，所以 CRLF 文件本就不合规；但**静默放行比报错危险得多**——
  // 实测一份 CRLF 正文会让标题匹配失败、标准解析成空集，于是 done 悄悄越过
  // 门禁而 doctor 还报一切正常（Codex 评审复现）。
  const d = repo();
  const t = runAdd({ directory: d, title: "T", acceptance: ["not done yet"], actor: ME });
  const p = taskPath(d, t.id);
  const raw = readFileSync(p, "utf8");
  const i = raw.indexOf("---", 3) + 4;
  writeFileSync(p, raw.slice(0, i) + raw.slice(i).replace(/\n/g, "\r\n"));

  assert.throws(() => runDone({ directory: d, id: t.id, actor: ME }), refusal(EXIT.gate),
    "CRLF 正文不该让门禁失效");
});

test("多道门禁一起不过时全部报出，退出码取最严重", () => {
  const d = repo();
  const parent = runAdd({ directory: d, title: "parent", acceptance: ["a"], actor: ME });
  runAdd({ directory: d, title: "kid", parent: parent.id, actor: ME });
  runClaim({ directory: d, id: parent.id, actor: OTHER });
  try {
    runDone({ directory: d, id: parent.id, actor: ME });
    assert.fail("应当被拒绝");
  } catch (e) {
    const report = (e as GateRefused).report;
    assert.deepEqual(report.refused.map((r) => r.gate).sort(), ["acceptance", "children", "ownership"]);
    assert.equal(report.code, EXIT.conflict);
  }
});

test("被拒绝的迁移什么都不改：文件字节不变、Log 没长、租约不变（spec §6.1）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", acceptance: ["not done"], actor: ME });
  runClaim({ directory: d, id: t.id, actor: ME });
  const before = read(d, t.id);
  const beforeLogs = logsOf(d, t.id).length;
  const beforeLease = JSON.stringify(readLease(discoverLedger(d), t.id));

  assert.throws(() => runDone({ directory: d, id: t.id, actor: ME }));
  assert.equal(read(d, t.id), before, "任务文件不得改动");
  assert.equal(logsOf(d, t.id).length, beforeLogs, "Log 一行都不得追加");
  assert.equal(JSON.stringify(readLease(discoverLedger(d), t.id)), beforeLease, "租约不得改动");
});

// ---- --force ----

test("--force 越过每一道门禁，并记 forced=true 与理由", () => {
  const d = repo();
  const parent = runAdd({ directory: d, title: "parent", acceptance: ["a"], actor: ME });
  runAdd({ directory: d, title: "kid", parent: parent.id, actor: ME });
  runClaim({ directory: d, id: parent.id, actor: OTHER });

  const r = runDone({ directory: d, id: parent.id, actor: ME, force: true, reason: "shipping anyway" });
  assert.equal(r.forced, true);
  const last = logsOf(d, parent.id).at(-1);
  assert.ok(last?.ok);
  assert.equal(last.args["forced"], "true");
  assert.equal(last.text, "shipping anyway");
});

test("--force 不带 --reason 是用法错误（退出 1）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  assert.throws(() => runDone({ directory: d, id: t.id, actor: ME, force: true }),
    (e: unknown) => (e as { code: number }).code === EXIT.usage);
});

test("--reason 不带 --force 也是用法错误", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  assert.throws(() => runDone({ directory: d, id: t.id, actor: ME, reason: "why" }),
    (e: unknown) => (e as { code: number }).code === EXIT.usage);
});

test("理由里的换行被压成空格 —— 否则 Log 行断开，整个文件解析不了", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  runDone({ directory: d, id: t.id, actor: ME, force: true, reason: "line one\nline two\n  indented" });
  const last = logsOf(d, t.id).at(-1);
  assert.ok(last?.ok, "Log 行必须仍然可解析");
  assert.equal(last.text, "line one line two indented");
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("强制完成的任务在 ls 里标 unverified（F04 的跨 feature 契约）", () => {
  // F04 的 isUnverified 读最近一次 done|closed 的 forced=true。
  // 这里写出来的形状必须正好能被它解析。
  const d = repo();
  const t = runAdd({ directory: d, title: "T", acceptance: ["a"], actor: ME });
  runDone({ directory: d, id: t.id, actor: ME, force: true, reason: "rushed" });
  const dto = runLs({ directory: d, closed: true }).tasks.find((x) => x.id === t.id);
  assert.equal(dto?.unverified, true);
});

test("强制关闭同样标 unverified", () => {
  const d = repo();
  const parent = runAdd({ directory: d, title: "parent", actor: ME });
  runAdd({ directory: d, title: "kid", parent: parent.id, actor: ME });
  runClose({ directory: d, id: parent.id, actor: ME, resolution: "wontfix", force: true, reason: "dropped" });
  assert.equal(runLs({ directory: d, closed: true }).tasks.find((x) => x.id === parent.id)?.unverified, true);
});

// ---- done 的 Log 行 ----

test("done 的 Log 行按 spec §5.3.3：verify / commit / dirty", () => {
  const d = repo({ git: true });
  const t = runAdd({ directory: d, title: "T", actor: ME });
  runDone({ directory: d, id: t.id, actor: ME });
  const last = logsOf(d, t.id).at(-1);
  assert.ok(last?.ok);
  assert.equal(last.verb, "done");
  assert.equal(last.args["verify"], "none", "F06 不执行任何命令；F07 会填 pass / fail");
  assert.match(last.args["commit"] ?? "", /^[0-9a-f]{7}$/);
  assert.ok(last.args["dirty"] === "true" || last.args["dirty"] === "false");
});

test("不在 git 仓库里时省略 commit 与 dirty，而不是写 unknown", () => {
  // 一个假的 sha 比没有更坏：读日志的人会拿它去 checkout。
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  runDone({ directory: d, id: t.id, actor: ME });
  const last = logsOf(d, t.id).at(-1);
  assert.ok(last?.ok);
  assert.equal(last.args["commit"], undefined);
  assert.equal(last.args["dirty"], undefined);
  assert.equal(last.args["verify"], "none");
});

// ---- close ----

test("close 写入 resolution 并记 closed resolution=…", () => {
  const d = repo();
  for (const res of ["wontfix", "duplicate", "obsolete"]) {
    const t = runAdd({ directory: d, title: res, actor: ME });
    const r = runClose({ directory: d, id: t.id, actor: ME, resolution: res });
    assert.equal(r.resolution, res);
    assert.match(read(d, t.id), new RegExp(`^resolution: "${res}"$`, "m"));
    const last = logsOf(d, t.id).at(-1);
    assert.ok(last?.ok);
    assert.equal(last.verb, "closed");
    assert.equal(last.args["resolution"], res);
  }
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("close 不给 --resolution、或给不合法的值 → 退出 1", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  for (const resolution of [undefined, "", "nonsense", "DONE"]) {
    assert.throws(() => runClose({ directory: d, id: t.id, actor: ME, resolution }),
      (e: unknown) => (e as { code: number }).code === EXIT.usage, String(resolution));
  }
});

test("close -r done 被拒 —— 那是 done 命令的事（spec §6.1 两行分开写）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  assert.throws(() => runClose({ directory: d, id: t.id, actor: ME, resolution: "done" }),
    (e: unknown) => (e as { code: number }).code === EXIT.usage);
});

// ---- reopen ----

test("reopen 同时移除 resolution 与 assignee（FR-D5 / 不变量 3）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  runClaim({ directory: d, id: t.id, actor: ME });
  runDone({ directory: d, id: t.id, actor: ME });
  assert.match(read(d, t.id), /^resolution:/m);

  runReopen({ directory: d, id: t.id, actor: ME });
  assert.match(read(d, t.id), /^status: "open"$/m);
  assert.doesNotMatch(read(d, t.id), /^resolution:/m, "resolution 必须被移除");
  assert.doesNotMatch(read(d, t.id), /^assignee:/m, "assignee 也必须被移除，否则违反不变量 3");
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("reopen 记 reopened，并清掉租约", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  runClaim({ directory: d, id: t.id, actor: ME });
  runDone({ directory: d, id: t.id, actor: ME });
  runReopen({ directory: d, id: t.id, actor: ME });
  assert.equal(logsOf(d, t.id).at(-1)?.ok === true
    && (logsOf(d, t.id).at(-1) as { verb: string }).verb, "reopened");
  assert.equal(existsSync(join(leaseDirFor(discoverLedger(d)), `${t.id}.json`)), false);
});

test("reopen 一个未关闭的任务 → 退出 2", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  assert.throws(() => runReopen({ directory: d, id: t.id, actor: ME }), refusal(EXIT.gate));
});

test("reopen 别人关掉的任务是允许的 —— 关闭的任务没有持有者", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  runClaim({ directory: d, id: t.id, actor: OTHER });
  runDone({ directory: d, id: t.id, actor: OTHER });
  assert.doesNotThrow(() => runReopen({ directory: d, id: t.id, actor: ME }));
});

// ---- 通用 ----

test("done / close 之后租约被删、doctor 通过", () => {
  const d = repo();
  const a = runAdd({ directory: d, title: "a", actor: ME });
  runClaim({ directory: d, id: a.id, actor: ME });
  runDone({ directory: d, id: a.id, actor: ME });
  assert.equal(readLease(discoverLedger(d), a.id), null);

  const b = runAdd({ directory: d, title: "b", actor: ME });
  runClaim({ directory: d, id: b.id, actor: ME });
  runClose({ directory: d, id: b.id, actor: ME, resolution: "wontfix" });
  assert.equal(readLease(discoverLedger(d), b.id), null);
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("带 external 与怪键的任务照常关闭，键值原样保留", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  const p = taskPath(d, t.id);
  writeFileSync(p, readFileSync(p, "utf8").replace(/^status: "open"$/m,
    'status: "open"\nexternal:\n  linear:\n    id: "ENG-1"\n"#meta": "keep"\nx-count: 5'));
  runDone({ directory: d, id: t.id, actor: ME });
  const after = read(d, t.id);
  assert.match(after, /ENG-1/);
  assert.match(after, /"#meta"/);
  assert.match(after, /x-count: 5/);
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("不存在的任务 → 退出 1，并指向 ls", () => {
  const d = repo();
  for (const run of [
    () => runDone({ directory: d, id: "tp-zzzzzz", actor: ME }),
    () => runClose({ directory: d, id: "tp-zzzzzz", actor: ME, resolution: "wontfix" }),
    () => runReopen({ directory: d, id: "tp-zzzzzz", actor: ME }),
  ]) {
    assert.throws(run, (e: unknown) =>
      (e as { code: number }).code === EXIT.usage && /todopi ls/.test((e as Error).message));
  }
});

test("updated 被刷新（spec §6.3）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  const p = taskPath(d, t.id);
  writeFileSync(p, readFileSync(p, "utf8").replace(/^updated: ".*"$/m, 'updated: "2020-01-01T00:00:00Z"'));
  runDone({ directory: d, id: t.id, actor: ME });
  assert.doesNotMatch(read(d, t.id), /^updated: "2020-01-01T00:00:00Z"$/m);
});
