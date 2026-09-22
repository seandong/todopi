import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { runRelease } from "../../src/commands/release.ts";
import { runDoctor } from "../../src/commands/doctor.ts";
import { renderRelease } from "../../src/output/render/claim.ts";
import { discoverLedger } from "../../src/format/discover.ts";
import { readLease, leaseDirFor } from "../../src/format/lease.ts";
import { parseLogLine, logLines } from "../../src/domain/validate.ts";
import { EXIT } from "../../src/exit.ts";

const ME = "me@host";
const OTHER = "other@host";

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-release-"));
  runInit({ directory: d, prefix: "tp" });
  return d;
}
const taskPath = (d: string, id: string) => join(d, ".todopi", "tasks", `${id}.md`);
const read = (d: string, id: string) => readFileSync(taskPath(d, id), "utf8");
const leasePath = (d: string, id: string) => join(leaseDirFor(discoverLedger(d)), `${id}.json`);
const logsOf = (d: string, id: string) =>
  logLines(read(d, id).split("---\n").slice(2).join("---\n")).map(parseLogLine);

/** 建一个已被我认领的任务。 */
function mine(d: string): string {
  const t = runAdd({ directory: d, title: "work", actor: ME });
  runClaim({ directory: d, id: t.id, actor: ME });
  return t.id;
}

test("release 清空 assignee、改回 open、删除租约、记 released（FR-C2）", () => {
  const d = repo();
  const id = mine(d);

  const r = runRelease({ directory: d, id, actor: ME });
  assert.equal(r.status, "open");
  assert.match(read(d, id), /^status: "open"$/m);
  assert.doesNotMatch(read(d, id), /^assignee:/m, "不变量 3：open 时 assignee 必须缺席");
  assert.equal(readLease(discoverLedger(d), id), null);
  assert.equal(existsSync(leasePath(d, id)), false);

  const last = logsOf(d, id).at(-1);
  assert.ok(last?.ok);
  assert.equal(last.verb, "released");
});

test("release 之后任务通过 doctor", () => {
  const d = repo();
  const id = mine(d);
  runRelease({ directory: d, id, actor: ME });
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("别人持有的任务不能 release —— 退出 3，且什么都不改", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  runClaim({ directory: d, id: t.id, actor: OTHER });

  const before = read(d, t.id);
  assert.throws(() => runRelease({ directory: d, id: t.id, actor: ME }),
    (e: unknown) => (e as { code: number }).code === EXIT.conflict);
  assert.equal(read(d, t.id), before);
  assert.ok(existsSync(leasePath(d, t.id)), "租约也不得被删");
});

test("拒绝时指向 claim --steal —— 那条路会留痕", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  runClaim({ directory: d, id: t.id, actor: OTHER });
  assert.throws(() => runRelease({ directory: d, id: t.id, actor: ME }), /--steal/);
});

test("open 的任务不能 release —— §6.1 没有这一行，退出 2", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  assert.throws(() => runRelease({ directory: d, id: t.id, actor: ME }),
    (e: unknown) => (e as { code: number }).code === EXIT.gate);
});

test("closed 的任务不能 release —— 退出 2", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  const p = taskPath(d, t.id);
  writeFileSync(p, readFileSync(p, "utf8").replace(/^status: "open"$/m, 'status: "closed"\nresolution: "done"'));
  assert.throws(() => runRelease({ directory: d, id: t.id, actor: ME }),
    (e: unknown) => (e as { code: number }).code === EXIT.gate);
});

test("租约文件已经不在了，release 仍然成功", () => {
  // SIGKILL 或 doctor --fix 之后租约可能已经没了，而任务文件还是 in_progress。
  // 这时 release 的职责恰恰是把文件改回去；因为租约不见了就失败，
  // 等于把用户锁死在一个只能手改文件才能脱身的状态里。
  const d = repo();
  const id = mine(d);
  unlinkSync(leasePath(d, id));

  assert.doesNotThrow(() => runRelease({ directory: d, id, actor: ME }));
  assert.match(read(d, id), /^status: "open"$/m);
});

test("release 一个别的机器认领的任务（本机无租约）仍按 assignee 判断", () => {
  // 本机没有租约不等于没人持有——assignee 才是 committed 的事实（spec §8）。
  const d = repo();
  const t = runAdd({ directory: d, title: "work", actor: ME });
  const p = taskPath(d, t.id);
  writeFileSync(p, readFileSync(p, "utf8")
    .replace(/^status: "open"$/m, `status: "in_progress"\nassignee: "${OTHER}"`));
  assert.equal(existsSync(leasePath(d, t.id)), false, "前提：本机没有租约");
  assert.throws(() => runRelease({ directory: d, id: t.id, actor: ME }),
    (e: unknown) => (e as { code: number }).code === EXIT.conflict);
});

test("不存在的任务 → 退出 1，并指向 ls", () => {
  const d = repo();
  assert.throws(() => runRelease({ directory: d, id: "tp-zzzzzz", actor: ME }),
    (e: unknown) => (e as { code: number }).code === EXIT.usage && /todopi ls/.test((e as Error).message));
});

test("updated 被刷新（spec §6.3）", () => {
  const d = repo();
  const id = mine(d);
  const p = taskPath(d, id);
  writeFileSync(p, readFileSync(p, "utf8").replace(/^updated: ".*"$/m, 'updated: "2020-01-01T00:00:00Z"'));
  runRelease({ directory: d, id, actor: ME });
  assert.doesNotMatch(read(d, id), /^updated: "2020-01-01T00:00:00Z"$/m);
});

test("输出是英文", () => {
  const d = repo();
  const id = mine(d);
  const out = renderRelease(runRelease({ directory: d, id, actor: ME }));
  assert.doesNotMatch(out, /[一-鿿]/, "CLI 输出 MUST 是英文");
  assert.match(out, new RegExp(id));
});

test("claim → release → claim 可以循环，租约跟着走", () => {
  const d = repo();
  const id = mine(d);
  runRelease({ directory: d, id, actor: ME });
  assert.equal(existsSync(leasePath(d, id)), false);
  const again = runClaim({ directory: d, id, actor: OTHER });
  assert.equal(again.stolen, false, "释放过的任务是 open，认领它不算接管");
  assert.equal(readLease(discoverLedger(d), id)?.actor, OTHER);
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("租约目录存在但空着时 release 不出意外", () => {
  const d = repo();
  const id = mine(d);
  mkdirSync(leaseDirFor(discoverLedger(d)), { recursive: true });
  assert.doesNotThrow(() => runRelease({ directory: d, id, actor: ME }));
});



// release 的竞态用例在 tests/commands/release.concurrent.test.ts（真并发）
// 与 tests/commands/release.barrier.test.ts（执行屏障）。
// 原先放在这里的三条是串行的——spawnSync 在循环里、claim/release 顺序调用——
// 证明不了注释声称的竞态已修，有缺陷的实现也能通过（Codex 第二轮评审指出）。
