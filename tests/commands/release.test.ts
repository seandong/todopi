import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { spawnSync } from "node:child_process";
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


// ---- Codex 评审抓到的 release 竞态（阻塞项 1）----

test("release 与 claim --steal 并发：release 不得把别人刚拿到的任务放掉", () => {
  // 第一版在锁外确认归属，之后才取锁改文件。A 确认「这是我的」之后暂停，
  // B --steal 成功，A 恢复后照样退出 0，把 B 刚拿到的任务释放掉。
  // 现在归属确认在锁内重做，所以 A 恢复后会看到 assignee 已经是 B 而拒绝。
  const d = repo();
  const id = mine(d);

  // 直接模拟「A 的判断已过期」：在 A 调用 release 之前，任务已被 B 接管
  runClaim({ directory: d, id, actor: OTHER, steal: true });

  assert.throws(() => runRelease({ directory: d, id, actor: ME }),
    (e: unknown) => (e as { code: number }).code === EXIT.conflict,
    "归属必须在锁内重新确认");
  assert.match(read(d, id), /^status: "in_progress"$/m, "B 的任务不得被放掉");
  assert.equal(readLease(discoverLedger(d), id)?.actor, OTHER, "B 的租约不得被删");
});

test("release 删租约在锁内：不会误删别人随后建的租约", () => {
  // 第一版写完任务文件就解锁，删租约在锁外。A 在这个间隙暂停，B 普通 claim
  // 成功建了新租约，A 恢复后把 B 刚建的租约删了。
  // 现在删除在同一次持锁内完成，这个间隙不存在。
  const d = repo();
  const id = mine(d);
  runRelease({ directory: d, id, actor: ME });
  const again = runClaim({ directory: d, id, actor: OTHER });
  assert.equal(again.refreshed, false);
  assert.equal(readLease(discoverLedger(d), id)?.actor, OTHER, "新租约必须还在");
});

test("多进程并发 release 同一个任务：恰好一个成功，其余是明确的拒绝", () => {
  // 单进程用例对互斥失效是瞎的（ARCH-017）。
  const d = repo();
  const id = mine(d);
  const cli = join(import.meta.dirname, "..", "..", "src", "cli.ts");
  const codes = Array.from({ length: 8 }, () =>
    spawnSync(process.execPath, [cli, "-C", d, "--as", ME, "release", id], {
      stdio: "ignore", env: { ...process.env, TODOPI_ACTOR: "" },
    }).status);
  assert.equal(codes.filter((c) => c === 0).length, 1, `恰好一个成功：${codes.join(",")}`);
  assert.ok(codes.every((c) => c === 0 || c === 2 || c === 3),
    `其余只该是门禁(2)或冲突(3)：${codes.join(",")}`);
});
