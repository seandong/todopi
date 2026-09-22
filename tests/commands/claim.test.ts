import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { runDoctor } from "../../src/commands/doctor.ts";
import { runLs } from "../../src/commands/ls.ts";
import { renderClaim, renderClaimJson } from "../../src/output/render/claim.ts";
import { discoverLedger } from "../../src/format/discover.ts";
import { readLease, leaseDirFor } from "../../src/format/lease.ts";
import { parseLogLine, logLines } from "../../src/domain/validate.ts";
import { EXIT } from "../../src/exit.ts";

const ME = "me@host";
const OTHER = "other@host";

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-claim-"));
  runInit({ directory: d, prefix: "tp" });
  return d;
}
const taskPath = (d: string, id: string) => join(d, ".todopi", "tasks", `${id}.md`);
const read = (d: string, id: string) => readFileSync(taskPath(d, id), "utf8");
const lease = (d: string, id: string) => readLease(discoverLedger(d), id);

/** 手工把任务改成别人持有且已陈旧（updated 很旧，且本机没有租约）。 */
function heldByOtherStale(d: string, id: string): void {
  const p = taskPath(d, id);
  writeFileSync(p, readFileSync(p, "utf8")
    .replace(/^status: "open"$/m, `status: "in_progress"\nassignee: "${OTHER}"`)
    .replace(/^updated: ".*"$/m, 'updated: "2020-01-01T00:00:00Z"'));
}

const logsOf = (d: string, id: string) =>
  logLines(read(d, id).split("---\n").slice(2).join("---\n")).map(parseLogLine);

test("认领一个 open 任务：状态、assignee、租约、Log 都对", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  const r = runClaim({ directory: d, id: t.id, actor: ME });

  assert.equal(r.status, "in_progress");
  assert.equal(r.assignee, ME);
  assert.equal(r.stolen, false);
  assert.equal(r.refreshed, false);
  assert.equal(r.replaced, undefined);

  assert.match(read(d, t.id), /^status: "in_progress"$/m);
  assert.match(read(d, t.id), new RegExp(`^assignee: "${ME}"$`, "m"));
  assert.equal(lease(d, t.id)?.actor, ME);

  const last = logsOf(d, t.id).at(-1);
  assert.ok(last?.ok);
  assert.equal(last.verb, "claimed");
  assert.equal(last.args["steal"], undefined, "没替换任何人就不该有 steal");
});

test("认领之后任务仍然通过 doctor（FR-T1 的验收对每个写命令都成立）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  runClaim({ directory: d, id: t.id, actor: ME });
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("updated 被刷新（spec §6.3）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  const before = read(d, t.id).match(/^updated: "(.*)"$/m)?.[1] ?? "";
  writeFileSync(taskPath(d, t.id), read(d, t.id).replace(/^updated: ".*"$/m, 'updated: "2020-01-01T00:00:00Z"'));
  runClaim({ directory: d, id: t.id, actor: ME });
  assert.ok((read(d, t.id).match(/^updated: "(.*)"$/m)?.[1] ?? "") >= before);
});

test("陈旧的任务无需 --steal 即可重新认领，Log 记 steal=true 并写明被替换者", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  heldByOtherStale(d, t.id);

  const r = runClaim({ directory: d, id: t.id, actor: ME });
  assert.equal(r.stolen, true);
  assert.equal(r.replaced, OTHER);
  assert.equal(lease(d, t.id)?.actor, ME);

  const last = logsOf(d, t.id).at(-1);
  assert.ok(last?.ok);
  assert.equal(last.verb, "claimed");
  assert.equal(last.args["steal"], "true");
  assert.equal(last.text, OTHER, "spec §5.3.3：text 是被替换的 actor");
});

test("租约未过期且是别人的 → 拒绝，退出 3，且什么都不改", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  runClaim({ directory: d, id: t.id, actor: OTHER });     // 别人先认领，租约新鲜

  const before = read(d, t.id);
  const beforeLease = JSON.stringify(lease(d, t.id));
  assert.throws(() => runClaim({ directory: d, id: t.id, actor: ME }),
    (e: unknown) => (e as { code: number }).code === EXIT.conflict);

  // spec §6.1：A refused transition changes nothing and MUST NOT append to the Log.
  assert.equal(read(d, t.id), before, "被拒绝的 claim 不得改动任务文件");
  assert.equal(JSON.stringify(lease(d, t.id)), beforeLease, "也不得改动租约");
});

test("--steal 覆盖未过期的租约", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  runClaim({ directory: d, id: t.id, actor: OTHER });

  const r = runClaim({ directory: d, id: t.id, actor: ME, steal: true });
  assert.equal(r.stolen, true);
  assert.equal(r.replaced, OTHER);
  assert.equal(lease(d, t.id)?.actor, ME, "租约要换成我的");
});

test("重新认领时 claimed_at 也换成现在 —— 接管是一次新的认领", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  runClaim({ directory: d, id: t.id, actor: OTHER });
  const before = lease(d, t.id)?.claimed_at ?? "";
  runClaim({ directory: d, id: t.id, actor: ME, steal: true });
  assert.ok((lease(d, t.id)?.claimed_at ?? "") >= before);
});

test("认领已经是自己的任务 → 刷新，不记 steal", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  runClaim({ directory: d, id: t.id, actor: ME });
  const before = logsOf(d, t.id).length;

  const r = runClaim({ directory: d, id: t.id, actor: ME });
  assert.equal(r.refreshed, true);
  assert.equal(r.stolen, false);
  assert.equal(logsOf(d, t.id).length, before, "刷新不是迁移，不该再写一条 claimed");
});

test("刷新会更新心跳，但不改 claimed_at（FR-C3）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  runClaim({ directory: d, id: t.id, actor: ME });
  const first = lease(d, t.id);
  runClaim({ directory: d, id: t.id, actor: ME });
  const second = lease(d, t.id);
  assert.equal(second?.claimed_at, first?.claimed_at, "认领时刻不变");
  assert.ok((second?.heartbeat_at ?? "") >= (first?.heartbeat_at ?? ""));
});

test("closed 的任务不能认领 —— 退出 2", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  const p = taskPath(d, t.id);
  writeFileSync(p, readFileSync(p, "utf8").replace(/^status: "open"$/m, 'status: "closed"\nresolution: "done"'));
  assert.throws(() => runClaim({ directory: d, id: t.id, actor: ME }),
    (e: unknown) => (e as { code: number }).code === EXIT.gate);
  assert.equal(existsSync(join(leaseDirFor(discoverLedger(d)), `${t.id}.json`)), false,
    "被拒绝的 claim 不得留下租约");
});

test("不存在的任务 → 退出 1，并指向 ls", () => {
  const d = repo();
  assert.throws(() => runClaim({ directory: d, id: "tp-zzzzzz", actor: ME }),
    (e: unknown) => (e as { code: number }).code === EXIT.usage && /todopi ls/.test((e as Error).message));
});

test("非法的 --as 当场报错，退出 1", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  assert.throws(() => runClaim({ directory: d, id: t.id, actor: "bad actor" }),
    (e: unknown) => (e as { code: number }).code === EXIT.usage);
});

test("输出是英文，--json 可解析且字段名跟规格走", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  const r = runClaim({ directory: d, id: t.id, actor: ME });
  assert.doesNotMatch(renderClaim(r), /[一-鿿]/, "CLI 输出 MUST 是英文");
  const parsed = JSON.parse(renderClaimJson(r)) as Record<string, unknown>;
  for (const k of ["id", "title", "status", "assignee", "stolen", "refreshed"]) {
    assert.ok(k in parsed, `--json 缺少字段 ${k}`);
  }
});

test("重新认领时文本输出说明替换了谁", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  heldByOtherStale(d, t.id);
  const out = renderClaim(runClaim({ directory: d, id: t.id, actor: ME }));
  assert.match(out, new RegExp(OTHER.replace("@", "@")), "被替换者要出现在输出里");
});

test("带 external 的任务照常认领 —— 那个键原样保留", () => {
  // F05 Task 1 抽 updateTask 的直接理由在这里收口。
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  const p = taskPath(d, t.id);
  writeFileSync(p, readFileSync(p, "utf8").replace(
    /^status: "open"$/m,
    'status: "open"\nexternal:\n  linear:\n    id: "ENG-1"\n    url: "https://x"'));
  runClaim({ directory: d, id: t.id, actor: ME });
  assert.match(read(d, t.id), /ENG-1/);
  assert.equal(runDoctor({ directory: d }).ok, true);
});

// ---- Codex 评审 F05 抓到的六个阻塞项，逐条钉住 ----

test("[跨 worktree] 本地任务说 open，但共享租约是别人的活租约 → 拒绝，退出 3", () => {
  // 租约跨 worktree 共享（.git/todopi/leases/），而每个 worktree 有自己的
  // .todopi/tasks/。所以本地文件说 open 不代表没人持有它。
  // 第一版以为「既有租约只有两种来源」——要接管的那个人，或崩溃留下的孤儿——
  // 漏掉了这第三种，于是不带 --steal 就覆盖了别人的活租约。
  const d = repo();
  const t = runAdd({ directory: d, title: "x", actor: OTHER });
  runClaim({ directory: d, id: t.id, actor: OTHER });
  const p = taskPath(d, t.id);
  writeFileSync(p, readFileSync(p, "utf8")
    .replace(/^status: "in_progress"$/m, 'status: "open"')
    .replace(/^assignee: ".*"\n/m, ""));

  assert.throws(() => runClaim({ directory: d, id: t.id, actor: ME }),
    (e: unknown) => (e as { code: number }).code === EXIT.conflict);
  assert.equal(lease(d, t.id)?.actor, OTHER, "别人的活租约不得被覆盖");
});

test("[跨 worktree] --steal 可以接管，且租约换人", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "x", actor: OTHER });
  runClaim({ directory: d, id: t.id, actor: OTHER });
  const p = taskPath(d, t.id);
  writeFileSync(p, readFileSync(p, "utf8")
    .replace(/^status: "in_progress"$/m, 'status: "open"')
    .replace(/^assignee: ".*"\n/m, ""));

  assert.doesNotThrow(() => runClaim({ directory: d, id: t.id, actor: ME, steal: true }));
  assert.equal(lease(d, t.id)?.actor, ME);
});

test("[跨 worktree] 别人的租约已过期时无需 --steal", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "x", actor: OTHER });
  runClaim({ directory: d, id: t.id, actor: OTHER });
  const lp = join(leaseDirFor(discoverLedger(d)), `${t.id}.json`);
  const held = JSON.parse(readFileSync(lp, "utf8")) as Record<string, string>;
  writeFileSync(lp, JSON.stringify({ ...held, heartbeat_at: "2020-01-01T00:00:00Z" }));
  const p = taskPath(d, t.id);
  writeFileSync(p, readFileSync(p, "utf8")
    .replace(/^status: "in_progress"$/m, 'status: "open"')
    .replace(/^assignee: ".*"\n/m, ""));

  assert.doesNotThrow(() => runClaim({ directory: d, id: t.id, actor: ME }));
  assert.equal(lease(d, t.id)?.actor, ME);
});

test("[校验失败] 被拒绝的 claim 不得留下租约（spec §6.1）", () => {
  // 第一版在校验之前就把租约写了：命令退出 1、任务文件不变，而新租约已落盘。
  const d = repo();
  const t = runAdd({ directory: d, title: "x", actor: ME });
  const p = taskPath(d, t.id);
  writeFileSync(p, readFileSync(p, "utf8").replace(/^title: ".*"$/m, 'title: ""'));
  const before = readFileSync(p, "utf8");

  assert.throws(() => runClaim({ directory: d, id: t.id, actor: ME }));
  assert.equal(existsSync(join(leaseDirFor(discoverLedger(d)), `${t.id}.json`)), false,
    "校验失败的 claim 不得留下租约");
  assert.equal(readFileSync(p, "utf8"), before, "任务文件也不得改动");
});

test("[无租约的刷新] 已是我的但本机没有租约 → 必须建出来，不能空报成功", () => {
  // 新克隆、或运行时文件被清理后会出现这种状态。只报成功而什么都不做的话，
  // 别人仍能立刻把它认领走，而我以为自己拿着它。
  const d = repo();
  const t = runAdd({ directory: d, title: "x", actor: ME });
  runClaim({ directory: d, id: t.id, actor: ME });
  unlinkSync(join(leaseDirFor(discoverLedger(d)), `${t.id}.json`));

  const r = runClaim({ directory: d, id: t.id, actor: ME });
  assert.equal(r.refreshed, true);
  assert.equal(lease(d, t.id)?.actor, ME, "租约必须被重建");
});

test("[心跳] 刷新确实推进了 heartbeat_at，不是原样不动", () => {
  // 原来的断言用 >=，不刷新也能通过（Codex 指出）。这里改成严格推进：
  // 先把心跳改到过去，再刷新，必须变新。
  const d = repo();
  const t = runAdd({ directory: d, title: "x", actor: ME });
  runClaim({ directory: d, id: t.id, actor: ME });
  const lp = join(leaseDirFor(discoverLedger(d)), `${t.id}.json`);
  const held = JSON.parse(readFileSync(lp, "utf8")) as Record<string, string>;
  writeFileSync(lp, JSON.stringify({ ...held, heartbeat_at: "2020-01-01T00:00:00Z" }));

  runClaim({ directory: d, id: t.id, actor: ME });
  const after = lease(d, t.id);
  assert.notEqual(after?.heartbeat_at, "2020-01-01T00:00:00Z", "心跳必须被推进");
  assert.equal(after?.claimed_at, held["claimed_at"], "认领时刻不变");
});

test("[扩展字段] 对象数组、含换行的值、数字与布尔，认领后原样保留", () => {
  // 第一版的发射器用 String(v) 强转：[{"k":"v"}] 变成 ["[object Object]"]，
  // 含换行的值写成读不回来的文件。F05 开始改写既有任务后这是数据损坏。
  const d = repo();
  const t = runAdd({ directory: d, title: "x", actor: ME });
  const p = taskPath(d, t.id);
  writeFileSync(p, readFileSync(p, "utf8").replace(/^status: "open"$/m,
    'status: "open"\nx-custom: [{"k": "v"}]\nx-text: "line1\\nline2"\nx-count: 5\nx-flag: true'));

  runClaim({ directory: d, id: t.id, actor: ME });
  const after = readFileSync(p, "utf8");
  assert.doesNotMatch(after, /object Object/, "对象不得被强转成字符串");
  assert.match(after, /x-count: 5$/m, "数字不得变成字符串");
  assert.match(after, /x-flag: true$/m, "布尔不得变成字符串");
  assert.match(after, /line1\\nline2/, "换行要被正确转义");
  assert.equal(runDoctor({ directory: d }).ok, true, "改写之后仍要通过 doctor");
});

test("[时钟] ls --ready 摆出来的任务，claim 一定认得 —— 含亚秒边界", () => {
  // 第一版 claim 把 now 先截成秒再判断陈旧，ls 用毫秒。实测在 02:00:00.500
  // 这种时刻两者给出相反结论：ready 队列摆出任务，claim 却退出 3。
  // spec §6.1 写 reclaim 那一行的全部理由就是要避免这种自相矛盾。
  //
  // 构造方式：把 updated 设成「当前秒 − 整租期」。带 bug 时 claim 算出的差
  // 恰好等于租期（不算过期），而 ls 多出当前毫秒数（算过期），必然分叉。
  const d = repo();
  const hours = discoverLedger(d).config.lease_hours;

  // 等到毫秒数不为 0，否则这条用例测不到那个差别
  let now = Date.now();
  while (now % 1000 === 0) now = Date.now();

  const t = runAdd({ directory: d, title: "boundary", actor: ME });
  const updatedAt = new Date(Math.floor(now / 1000) * 1000 - hours * 3_600_000)
    .toISOString().replace(/\.\d{3}Z$/, "Z");
  const p = taskPath(d, t.id);
  writeFileSync(p, readFileSync(p, "utf8")
    .replace(/^status: "open"$/m, `status: "in_progress"\nassignee: "${OTHER}"`)
    .replace(/^updated: ".*"$/m, `updated: ${JSON.stringify(updatedAt)}`));

  const ready = runLs({ directory: d, ready: true }).tasks.some((x) => x.id === t.id);
  if (!ready) return;                       // 不在 ready 队列里，这条用例不适用
  assert.doesNotThrow(() => runClaim({ directory: d, id: t.id, actor: ME }),
    "ready 队列摆出来的任务 claim 却拒绝 —— 两处的 stale 判断分叉了");
});

test("[时钟] 反过来也要成立：claim 认为不陈旧时，ready 也不该摆出来", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "fresh", actor: ME });
  runClaim({ directory: d, id: t.id, actor: OTHER });      // 别人刚认领，租约新鲜
  assert.equal(runLs({ directory: d, ready: true }).tasks.some((x) => x.id === t.id), false);
  assert.throws(() => runClaim({ directory: d, id: t.id, actor: ME }),
    (e: unknown) => (e as { code: number }).code === EXIT.conflict);
});
