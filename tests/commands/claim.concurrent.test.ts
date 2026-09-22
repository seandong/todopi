import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { discoverLedger } from "../../src/format/discover.ts";
import { readLease } from "../../src/format/lease.ts";

/**
 * 多进程互斥（ARCH-017 要求）。
 *
 * 单进程用例对互斥失效是**瞎的**——F03 已经证明过两次：10 个单进程用例在锁
 * 存在致命竞态时全部通过，只有多进程那一条会红。claim 同时写任务文件与租约
 * 文件，两者必须对同一个赢家一致，所以这条用例是本 feature 唯一能证明
 * 「恰好一个人拿到」的东西。
 */
const CLI = join(import.meta.dirname, "..", "..", "src", "cli.ts");

function claimInSubprocess(dir: string, id: string, actor: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, "-C", dir, "--as", actor, "claim", id], {
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, TODOPI_ACTOR: "" },
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? -1));
  });
}

test("N 个进程同时认领同一个任务，恰好一个成功", async () => {
  const d = mkdtempSync(join(tmpdir(), "todopi-claim-race-"));
  runInit({ directory: d, prefix: "tp" });
  const t = runAdd({ directory: d, title: "contested", actor: "seed@host" });

  const N = 20;
  const codes = await Promise.all(
    Array.from({ length: N }, (_, i) => claimInSubprocess(d, t.id, `w${i}@host`)),
  );

  const winners = codes.filter((c) => c === 0);
  const conflicts = codes.filter((c) => c === 3);
  assert.equal(winners.length, 1, `恰好一个赢家，实际 ${winners.length}（退出码：${codes.join(",")}）`);
  assert.equal(conflicts.length, N - 1, "其余全部是冲突（退出码 3），不该有别的失败");

  // 任务文件与租约必须指向**同一个**赢家。两者是两次写入，
  // 若互斥不严密，最容易出现的坏状态就是它们各自记了不同的人。
  const ledger = discoverLedger(d);
  const raw = readFileSync(join(d, ".todopi", "tasks", `${t.id}.md`), "utf8");
  const assignee = raw.match(/^assignee: "(.*)"$/m)?.[1];
  assert.ok(assignee !== undefined, "任务文件要有 assignee");
  assert.equal(readLease(ledger, t.id)?.actor, assignee, "任务文件与租约必须是同一个赢家");

  // 恰好一条 claimed，且不带 steal——没有人替换过任何人
  const logs = raw.split("\n").filter((l) => / claimed/.test(l));
  assert.equal(logs.length, 1, `只该有一条 claimed，实际 ${logs.length}`);
  assert.doesNotMatch(logs[0] ?? "", /steal=true/, "谁都没替换别人，不该有 steal");
});

test("N 个进程同时 --steal 同一个任务，任务文件与租约仍然一致", async () => {
  // --steal 走的是覆盖写，不靠 O_EXCL 挡人，所以互斥完全落在文件锁上。
  // 这条用例问的不是「几个人成功」（都可能成功，依次接管），
  // 而是「收场时两个文件说的是不是同一个人」。
  const d = mkdtempSync(join(tmpdir(), "todopi-steal-race-"));
  runInit({ directory: d, prefix: "tp" });
  const t = runAdd({ directory: d, title: "contested", actor: "seed@host" });

  const N = 12;
  await new Promise<void>((resolve, reject) => {
    const first = spawn(process.execPath, [CLI, "-C", d, "--as", "holder@host", "claim", t.id],
      { stdio: "ignore", env: { ...process.env, TODOPI_ACTOR: "" } });
    first.on("error", reject);
    first.on("exit", () => resolve());
  });

  const codes = await Promise.all(Array.from({ length: N }, (_, i) =>
    new Promise<number>((resolve, reject) => {
      const c = spawn(process.execPath, [CLI, "-C", d, "--as", `s${i}@host`, "claim", t.id, "--steal"],
        { stdio: "ignore", env: { ...process.env, TODOPI_ACTOR: "" } });
      c.on("error", reject);
      c.on("exit", (code) => resolve(code ?? -1));
    })));

  assert.ok(codes.every((c) => c === 0 || c === 3), `退出码只该是 0 或 3：${codes.join(",")}`);
  const ledger = discoverLedger(d);
  const raw = readFileSync(join(d, ".todopi", "tasks", `${t.id}.md`), "utf8");
  const assignee = raw.match(/^assignee: "(.*)"$/m)?.[1];
  assert.equal(readLease(ledger, t.id)?.actor, assignee, "任务文件与租约必须是同一个人");
});
