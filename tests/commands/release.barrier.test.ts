import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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
 * 用**握手屏障**验证「删租约发生在锁内」。
 *
 * 要验的是一个时序性质，而解锁与删除之间只有几条语句：实测 60 轮真并发一次都
 * 撞不上。先前用「盯锁文件消失再发 SIGSTOP」，能区分但仍依赖抢到调度窗口——
 * 发信号成功不等于恰好停在目标窗口（Codex 第四轮评审指出）。
 *
 * 现在用 preload 把 `fs.unlinkSync` 包一层（`tests/helpers/pause-before-unlink.mjs`），
 * 在删租约那一刻握手暂停。确认它真的停在那儿之后，直接断言**此刻锁还在**——
 * 这就是要验证的性质本身，一点调度运气都不需要。
 *
 * 能这么做的关键是 `syncBuiltinESMExports()`：Node 对内置模块的具名导入是
 * 实例化时的快照，光改 `fs.unlinkSync` 影响不到 `import { unlinkSync }`。
 * 我一度据此断定这条路走不通并写进了 D020，那个结论是错的。
 */
const CLI = join(import.meta.dirname, "..", "..", "src", "cli.ts");
const PRELOAD = join(import.meta.dirname, "..", "helpers", "pause-before-unlink.mjs");

function fixture(): { d: string; id: string } {
  const d = mkdtempSync(join(tmpdir(), "todopi-barrier-"));
  runInit({ directory: d, prefix: "tp" });
  const t = runAdd({ directory: d, title: "contested", actor: "seed@host" });
  runClaim({ directory: d, id: t.id, actor: "a@host" });
  return { d, id: t.id };
}

/** 自旋等条件成立；超时返回 false，让调用方给出明确失败而不是挂住。 */
function waitFor(cond: () => boolean, ms = 15_000): boolean {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) if (cond()) return true;
  return false;
}

test("删租约发生在锁内：暂停在删除点时，锁仍被该 release 进程持有", async () => {
  const { d, id } = fixture();
  const ledger = discoverLedger(d);
  const lockPath = lockPathFor(ledger);
  const leasePath = join(leaseDirFor(ledger), `${id}.json`);
  const arrived = join(d, "arrived");
  const proceed = join(d, "proceed");

  const a = spawn(process.execPath, ["--import", PRELOAD, CLI, "-C", d, "--as", "a@host", "release", id], {
    stdio: "ignore",
    env: {
      ...process.env, TODOPI_ACTOR: "",
      TODOPI_TEST_PAUSE_PATH: leasePath,
      TODOPI_TEST_ARRIVED: arrived,
      TODOPI_TEST_PROCEED: proceed,
    },
  });

  try {
    // 屏障到不了就是失败，不是「这一轮无效」——否则这条用例什么也没验证
    assert.ok(waitFor(() => existsSync(arrived)),
      "release 没有走到删租约那一步：屏障没到达，这条用例什么也没验证");

    // 要验证的性质本身：删除发生的那一刻，锁必须还被这个进程持有。
    assert.ok(existsSync(lockPath),
      "停在删租约处时锁已经不在了 —— 删除发生在锁外，这个窗口里别人能接管并建立租约，" +
      "而它随后会被删掉");

    // 顺带证明锁确实在挡人：此刻另一个写者必须进不来
    const blocked = spawnSync(process.execPath, [CLI, "-C", d, "--as", "b@host", "claim", id, "--steal"], {
      stdio: "ignore", env: { ...process.env, TODOPI_ACTOR: "" },
    });
    assert.notEqual(blocked.status, 0, "锁被持有时，另一个写者不该能完成接管");
  } finally {
    writeFileSync(proceed, "1");
    await new Promise((res) => { a.on("exit", res); });
  }

  assert.equal(readLease(ledger, id), null, "release 完成后租约应当已删除");
  assert.equal(existsSync(lockPath), false, "release 结束后锁要被释放");
  assert.match(readFileSync(join(d, ".todopi", "tasks", `${id}.md`), "utf8"), /^status: "open"$/m);
});
