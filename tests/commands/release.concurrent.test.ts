import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { discoverLedger } from "../../src/format/discover.ts";
import { readLease, leaseDirFor } from "../../src/format/lease.ts";

/**
 * release 的多进程竞态（ARCH-017）。
 *
 * 上一版这些用例用 `spawnSync` 在 `Array.from` 里循环——那是**串行**的，
 * 一个进程结束才启动下一个，制造不出「旧判断」与「删租约」之间的窗口，
 * 于是有缺陷的实现也能通过（Codex 第二轮评审指出）。
 * 这里全部改成异步同时起进程，并且每条用例都验证过：把实现退回有缺陷的
 * 形状时它会红。
 */
const CLI = join(import.meta.dirname, "..", "..", "src", "cli.ts");

function run(dir: string, actor: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [CLI, "-C", dir, "--as", actor, ...args], {
      stdio: "ignore", env: { ...process.env, TODOPI_ACTOR: "" },
    });
    c.on("error", reject);
    c.on("exit", (code) => resolve(code ?? -1));
  });
}

function repo(): { d: string; id: string } {
  const d = mkdtempSync(join(tmpdir(), "todopi-rel-race-"));
  runInit({ directory: d, prefix: "tp" });
  const t = runAdd({ directory: d, title: "contested", actor: "seed@host" });
  return { d, id: t.id };
}
const taskRaw = (d: string, id: string) => readFileSync(join(d, ".todopi", "tasks", `${id}.md`), "utf8");
const assigneeOf = (d: string, id: string) => taskRaw(d, id).match(/^assignee: "(.*)"$/m)?.[1];
const statusOf = (d: string, id: string) => taskRaw(d, id).match(/^status: "(.*)"$/m)?.[1];

test("release 与 claim --steal 真并发：任务文件、租约、结果三者必须自洽", async () => {
  // 这条要抓的是：A 在锁外确认「这是我的」之后 B 接管，A 恢复后照样把任务放掉。
  // 用 12 轮真并发去撞那个窗口——带缺陷的实现下，会出现「B 接管成功而任务被
  // A 放成 open」或「任务是 B 的而租约被 A 删了」。
  for (let round = 0; round < 12; round++) {
    const { d, id } = repo();
    runClaim({ directory: d, id, actor: "a@host" });

    const [relCode, stealCode] = await Promise.all([
      run(d, "a@host", ["release", id]),
      run(d, "b@host", ["claim", id, "--steal"]),
    ]);

    const status = statusOf(d, id);
    const assignee = assigneeOf(d, id);
    const lease = readLease(discoverLedger(d), id);
    const where = `第 ${round} 轮 release=${relCode} steal=${stealCode} status=${status} assignee=${assignee} lease=${lease?.actor}`;

    assert.ok(relCode === 0 || relCode === 2 || relCode === 3, `release 退出码异常：${where}`);
    assert.ok(stealCode === 0 || stealCode === 3, `steal 退出码异常：${where}`);

    if (status === "open") {
      assert.equal(assignee, undefined, `open 时不得有 assignee：${where}`);
      assert.equal(lease, null, `open 时不得留下租约：${where}`);
      assert.notEqual(stealCode, 0, `B 接管成功了，任务却是 open——A 把 B 的任务放掉了：${where}`);
    } else {
      assert.equal(status, "in_progress", `状态只能是 open 或 in_progress：${where}`);
      // 这就是那个缺陷的形状：任务记着 B，而 B 的租约被 A 的 release 删掉了。
      assert.ok(lease !== null, `任务是 ${assignee} 的，租约却不见了：${where}`);
      assert.equal(lease?.actor, assignee, `任务文件与租约必须是同一个人：${where}`);
      // 注意：release 与 steal 都退出 0 是**合法**的交错——A 先释放完成，
      // B 再认领那个已经 open 的任务。所以这里不能断言 release 必然失败。
    }
  }
});

test("多个 release 真并发：恰好一个成功，账本保持自洽", async () => {
  const { d, id } = repo();
  runClaim({ directory: d, id, actor: "a@host" });

  const codes = await Promise.all(Array.from({ length: 8 }, () => run(d, "a@host", ["release", id])));
  assert.equal(codes.filter((c) => c === 0).length, 1, `恰好一个成功：${codes.join(",")}`);
  assert.ok(codes.every((c) => c === 0 || c === 2 || c === 3), `其余只该是 2 或 3：${codes.join(",")}`);
  assert.equal(statusOf(d, id), "open");
  assert.equal(existsSync(join(leaseDirFor(discoverLedger(d)), `${id}.json`)), false, "租约必须被删掉");
});

test("release 与后继 claim 真并发：不得删掉别人随后建的租约", async () => {
  // 抓的是「A 写完任务文件、解锁、在删租约前暂停，B 普通 claim 建了新租约，
  // A 恢复后把它删了」。判据：收场若任务是 B 的，租约必须还在。
  for (let round = 0; round < 12; round++) {
    const { d, id } = repo();
    runClaim({ directory: d, id, actor: "a@host" });

    const [relCode, claimCode] = await Promise.all([
      run(d, "a@host", ["release", id]),
      run(d, "b@host", ["claim", id]),
    ]);

    const status = statusOf(d, id);
    const assignee = assigneeOf(d, id);
    const lease = readLease(discoverLedger(d), id);
    const where = `第 ${round} 轮 release=${relCode} claim=${claimCode} status=${status} assignee=${assignee} lease=${lease?.actor}`;

    if (status === "in_progress") {
      assert.ok(lease !== null, `任务是 ${assignee} 的，租约却不见了——被谁删了：${where}`);
      assert.equal(lease?.actor, assignee, `任务文件与租约必须是同一个人：${where}`);
    } else {
      assert.equal(lease, null, `open 时不得留下租约：${where}`);
    }
  }
});

test("跨 worktree 接管之后，旧持有者不能 release 掉新持有者的租约", async () => {
  // Codex 第二轮评审用真实双 worktree 复现的那条：
  // A 在树 1 claim → B 在树 2 --steal 成功 → A 在树 1 release 退出 0 并删掉 B 的活租约。
  // 这里用「共享租约换人、本树任务文件仍记 A」来等价地构造那个视图差。
  const { d, id } = repo();
  runClaim({ directory: d, id, actor: "a@host" });
  const { writeLease } = await import("../../src/format/lease.ts");
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  writeLease(discoverLedger(d), id, { actor: "b@host", claimed_at: now, heartbeat_at: now });

  const code = await run(d, "a@host", ["release", id]);
  assert.equal(code, 3, "本树 assignee 还记着我，但共享租约已是别人的 —— 必须拒绝");
  assert.equal(readLease(discoverLedger(d), id)?.actor, "b@host", "别人的活租约不得被删");
  assert.equal(statusOf(d, id), "in_progress", "任务文件也不得被改");
});
