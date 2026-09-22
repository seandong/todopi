import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { discoverLedger } from "../../src/format/discover.ts";
import { leaseDirFor } from "../../src/format/lease.ts";
import { lockPathFor } from "../../src/format/write.ts";

/**
 * 验证「删租约发生在锁内」。
 *
 * 断言的是性质本身：**锁消失的那一刻，租约必须也已经不在了。**
 * 删除在锁内的话，解锁时租约早删了；在锁外的话，解锁时它还在，
 * 而那个窗口里另一个写者可以拿到锁、接管任务、建立自己的租约，
 * 等原进程恢复后把它删掉。
 *
 * 屏障是 `SIGSTOP`：自旋盯着锁文件，在它消失的瞬间把 release 进程钉住，
 * 然后看租约在不在。上一版绕道「让 B 接管再放行 A」，多出的那一步只是把判据
 * 说复杂了——性质本身在钉住的那一刻就已经能看出来。
 *
 * **屏障没生效就是失败，不是通过。** 上一版的坏形状正在这里：若 SIGSTOP 一次
 * 都没撞上（比如平台不支持），它会零有效轮次却报告 pass（Codex 第三轮评审
 * 指出，并实测复现）。现在「至少钉住过一次」是一条独立的断言。
 *
 * 三向区分实测：正确实现通过；把删除挪到锁外则 12/12 违例；
 * 把 SIGSTOP 换成抛错（模拟平台不支持）则报「屏障没生效」而不是通过。
 */
const CLI = join(import.meta.dirname, "..", "..", "src", "cli.ts");

test("删租约在锁内：锁消失的那一刻，租约必须也已经不在", async () => {
  let pinned = 0;
  const violations: string[] = [];

  for (let round = 0; round < 12; round++) {
    const d = mkdtempSync(join(tmpdir(), "todopi-barrier-"));
    runInit({ directory: d, prefix: "tp" });
    const t = runAdd({ directory: d, title: "contested", actor: "seed@host" });
    runClaim({ directory: d, id: t.id, actor: "a@host" });

    const ledger = discoverLedger(d);
    const lockPath = lockPathFor(ledger);
    const leasePath = join(leaseDirFor(ledger), `${t.id}.json`);

    const a = spawn(process.execPath, [CLI, "-C", d, "--as", "a@host", "release", t.id],
      { stdio: "ignore", env: { ...process.env, TODOPI_ACTOR: "" } });

    // 自旋等锁出现再消失；消失的瞬间钉住进程
    const deadline = Date.now() + 5000;
    let sawLock = false, stopped = false;
    while (Date.now() < deadline) {
      if (existsSync(lockPath)) sawLock = true;
      else if (sawLock) {
        try { process.kill(a.pid as number, "SIGSTOP"); stopped = true; } catch { /* 已退出 */ }
        break;
      }
    }

    if (stopped) {
      pinned++;
      if (existsSync(leasePath)) violations.push(`第 ${round} 轮：锁已释放而租约仍在`);
      try { process.kill(a.pid as number, "SIGCONT"); } catch { /* 已退出 */ }
    }
    await new Promise((res) => { a.on("exit", res); a.kill("SIGCONT"); });
  }

  // 屏障没生效就不能算通过——否则这条用例什么也没验证
  assert.ok(pinned > 0,
    "一次都没能在解锁瞬间钉住 release 进程：屏障没生效，这条用例什么也没验证");
  assert.deepEqual(violations, [], violations.join("；"));
});
