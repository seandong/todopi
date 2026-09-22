import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { runDoctor } from "../../src/commands/doctor.ts";
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
