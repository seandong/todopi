import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { discoverLedger } from "../../src/format/discover.ts";
import { readLease, leaseDirFor } from "../../src/format/lease.ts";
import { lockPathFor } from "../../src/format/write.ts";

/**
 * 用**执行屏障**检验「删租约发生在锁内」。
 *
 * 为什么不能靠并发时序：那个窗口只有几条语句宽（解锁之后、删租约之前），
 * 实测 60 轮真并发一次都撞不上。Codex 第二轮评审因此指出，我原先那些
 * 「并发」用例证明不了任何事——它们甚至是串行的（spawnSync 在循环里）。
 *
 * 屏障是从**可观察状态**造出来的，不需要改动产品代码：盯着锁文件，
 * 在它消失的瞬间给 release 进程发 SIGSTOP。这样进程就被钉在
 * 「已解锁但还没做后续动作」的位置上。
 *   - 删租约在锁内：锁消失时租约早已删掉，这一轮无意义（跳过）；
 *   - 删租约在锁外：锁消失时租约还在，于是这一轮有意义——让 B 完整接管，
 *     再放行 A，看它会不会把 B 刚建的租约删掉。
 *
 * B 必须用 `--steal`：普通 claim 会被租约闸门按 spec §8 挡住，
 * 那条路径已经因为闸门而无害了。
 *
 * 实测区分度：正确实现 0 次违例，把删租约挪到锁外则 5/5 全中。
 */
const CLI = join(import.meta.dirname, "..", "..", "src", "cli.ts");
const ENV = { ...process.env, TODOPI_ACTOR: "" };

test("执行屏障：release 不会删掉接管者随后建立的租约", async () => {
  let conclusive = 0;
  const violations: string[] = [];

  for (let round = 0; round < 20 && conclusive < 3; round++) {
    const d = mkdtempSync(join(tmpdir(), "todopi-barrier-"));
    runInit({ directory: d, prefix: "tp" });
    const t = runAdd({ directory: d, title: "contested", actor: "seed@host" });
    runClaim({ directory: d, id: t.id, actor: "a@host" });

    const ledger = discoverLedger(d);
    const lockPath = lockPathFor(ledger);
    const leasePath = join(leaseDirFor(ledger), `${t.id}.json`);

    const a = spawn(process.execPath, [CLI, "-C", d, "--as", "a@host", "release", t.id],
      { stdio: "ignore", env: ENV });

    // 自旋等锁出现再消失，消失的瞬间把进程钉住
    const deadline = Date.now() + 5000;
    let sawLock = false, stopped = false;
    while (Date.now() < deadline) {
      if (existsSync(lockPath)) sawLock = true;
      else if (sawLock) {
        try { process.kill(a.pid as number, "SIGSTOP"); stopped = true; } catch { /* 已退出 */ }
        break;
      }
    }
    if (!stopped) { a.kill("SIGKILL"); continue; }

    // 租约已经没了 → A 是在锁内删的 → 这一轮问不出东西
    if (!existsSync(leasePath)) {
      try { process.kill(a.pid as number, "SIGCONT"); } catch { /* 已退出 */ }
      await new Promise((res) => a.on("exit", res));
      continue;
    }
    conclusive++;

    spawnSync(process.execPath, [CLI, "-C", d, "--as", "b@host", "claim", t.id, "--steal"],
      { stdio: "ignore", env: ENV });
    const takenOver = readLease(ledger, t.id)?.actor;

    try { process.kill(a.pid as number, "SIGCONT"); } catch { /* 已退出 */ }
    await new Promise((res) => a.on("exit", res));

    const after = readLease(ledger, t.id);
    const status = readFileSync(join(d, ".todopi", "tasks", `${t.id}.md`), "utf8")
      .match(/^status: "(.*)"$/m)?.[1];
    if (takenOver === "b@host" && after === null) {
      violations.push(`第 ${round} 轮：B 接管后租约被 A 删掉（status=${status}）`);
    }
  }

  assert.deepEqual(violations, [], violations.join("；"));
});
