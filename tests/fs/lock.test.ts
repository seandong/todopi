import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { withLock, type LockHolder } from "../../src/fs/lock.ts";

/** 早于任何合理宽限期的时间戳。 */
const longAgo = () => new Date(Date.now() - 120_000).toISOString();

const lockPath = () => join(mkdtempSync(join(tmpdir(), "todopi-lock-")), "lock");

test("持锁期间执行 fn 并返回它的值", () => {
  assert.equal(withLock(lockPath(), () => 42), 42);
});

test("fn 结束后锁被释放", () => {
  const p = lockPath();
  withLock(p, () => undefined);
  assert.ok(!existsSync(p), "锁文件必须被删掉");
});

test("fn 抛错时锁仍被释放", () => {
  const p = lockPath();
  assert.throws(() => withLock(p, () => { throw new Error("boom"); }), /boom/);
  assert.ok(!existsSync(p), "抛错路径也必须释放锁");
});

test("持锁期间锁文件记录 pid、host、时间与 nonce", () => {
  const p = lockPath();
  withLock(p, () => {
    const h = JSON.parse(readFileSync(p, "utf8")) as LockHolder;
    assert.equal(h.pid, process.pid);
    assert.equal(h.host, hostname());
    assert.match(h.at, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(h.nonce, /^[0-9a-f-]{36}$/, "每次获取都要有唯一的 nonce");
  });
});

test("锁文件从存在的第一刻内容就完整 —— 不能有「已创建但为空」的瞬间", () => {
  // 第一版用 openSync(path,"wx") + writeSync，那是两步，中间那一瞬文件是空的。
  // 别的进程读到 ""、JSON.parse 抛错，按当时的「损坏的锁当成陈旧锁」规则把这把
  // 刚合法获取的锁删掉。改用 link 之后这个瞬间不存在。
  const p = lockPath();
  withLock(p, () => {
    const raw = readFileSync(p, "utf8");
    assert.notEqual(raw, "", "锁文件不得为空");
    assert.doesNotThrow(() => JSON.parse(raw), "锁文件内容必须一直是合法 JSON");
  });
});

test.describe("不接管任何已存在的锁 —— 判定陈旧与删除无法原子完成", () => {
  // 三种写法都试过并被实测打败（见 src/fs/lock.ts 的注释）。清理陈旧租约是
  // doctor --fix 的职责（PRD FR-Q1），那是用户的显式动作而不是一次竞态。
  const held: Array<[string, () => LockHolder]> = [
    ["死进程留下的陈旧锁", () => ({ pid: 999999, host: hostname(), at: longAgo(), nonce: "stale" })],
    ["活着的本机进程的锁", () => ({ pid: process.pid, host: hostname(), at: new Date().toISOString(), nonce: "live" })],
    ["异主机的锁", () => ({ pid: 1, host: "some-other-machine", at: longAgo(), nonce: "remote" })],
  ];
  for (const [name, make] of held) {
    test(name, () => {
      const p = lockPath();
      const before = make();
      writeFileSync(p, JSON.stringify(before));
      assert.throws(() => withLock(p, () => undefined, { timeoutMs: 120 }), /lock/i);
      const after = JSON.parse(readFileSync(p, "utf8")) as LockHolder;
      assert.equal(after.nonce, before.nonce, "已存在的锁必须原封不动");
    });
  }

  test("内容损坏的锁同样不接管，但错误信息要说明怎么办", () => {
    const p = lockPath();
    writeFileSync(p, "not json at all");
    assert.throws(
      () => withLock(p, () => undefined, { timeoutMs: 120 }),
      /doctor --fix|remove the file/i,
      "错误信息必须告诉用户怎么清理",
    );
    assert.equal(readFileSync(p, "utf8"), "not json at all", "损坏的锁也不得被动");
  });
});

test("超时错误说明持有者是谁、进程还在不在、怎么清理", () => {
  const p = lockPath();
  writeFileSync(p, JSON.stringify({ pid: 999999, host: hostname(), at: longAgo(), nonce: "stale" }));
  try {
    withLock(p, () => undefined, { timeoutMs: 120 });
    assert.fail("应当抛错");
  } catch (e: unknown) {
    const msg = (e as Error).message;
    assert.match(msg, /999999/, "要报出持有者的 pid");
    assert.match(msg, /no longer running|stale/i, "要说明进程是否还在");
    assert.match(msg, /doctor --fix/, "要给出清理办法");
  }
});

test("释放时确认锁还是自己的 —— 不删后继者的锁", () => {
  const p = lockPath();
  const successor = { pid: process.pid, host: hostname(), at: new Date().toISOString(), nonce: "successor" };
  withLock(p, () => {
    // 模拟「持锁期间锁被 doctor --fix 清掉、又被别人取得」
    writeFileSync(p, JSON.stringify(successor));
  });
  assert.ok(existsSync(p), "后继者的锁必须还在");
  assert.equal((JSON.parse(readFileSync(p, "utf8")) as LockHolder).nonce, "successor");
});

test("锁目录不存在时自动创建 —— 首次写入时 leases/ 还不存在", () => {
  const dir = mkdtempSync(join(tmpdir(), "todopi-lock-"));
  assert.equal(withLock(join(dir, "deep", "nested", "lock"), () => "ok"), "ok");
});

test("嵌套调用同一把锁会失败 —— 提醒实现不要在持锁中再取锁", () => {
  const p = lockPath();
  assert.throws(
    () => withLock(p, () => withLock(p, () => undefined, { timeoutMs: 120 })),
    /lock/i,
  );
  assert.ok(!existsSync(p), "外层的释放仍要发生");
});

test("正常路径不产生任何临时文件或隔离文件", () => {
  const dir = mkdtempSync(join(tmpdir(), "todopi-lock-"));
  const p = join(dir, "lock");
  withLock(p, () => undefined);
  assert.deepEqual(readdirSync(dir), [], "目录里不得有残留");
});

test("真并发互斥：30 个进程各在锁内做一次读-改-写", { timeout: 60000 }, () => {
  // 这条用例必须是**多进程**的。上面 10 条单进程用例在锁有一个致命竞态时全部通过：
  // openSync(path,"wx") 创建文件与写入内容是两步，中间那一瞬别的进程读到 ""，
  // JSON.parse 抛错，按「损坏的锁当成陈旧锁」把刚合法获取的锁删掉。
  // 实测那个版本 30 个进程只数到 15（无锁基线 9）。
  const dir = mkdtempSync(join(tmpdir(), "todopi-lock-race-"));
  const lock = join(dir, "lock");
  const counter = join(dir, "counter");
  const worker = join(dir, "worker.mjs");
  const lockModule = pathToFileURL(join(import.meta.dirname, "..", "..", "src", "fs", "lock.ts")).href;

  writeFileSync(worker, `
import { withLock } from ${JSON.stringify(lockModule)};
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const [lock, counter] = process.argv.slice(2);
withLock(lock, () => {
  const n = existsSync(counter) ? Number(readFileSync(counter, "utf8")) : 0;
  const s = Date.now(); while (Date.now() - s < 4) {}   // 放大竞争窗口
  writeFileSync(counter, String(n + 1));
}, { timeoutMs: 30000 });
`);

  // 用一条 shell 同时启动 N 个进程并 wait，比在 Node 里管理子进程简单得多，
  // 而这条用例要测的是锁，不是进程管理。
  const N = 30;
  const launch = Array.from({ length: N },
    () => `"${process.execPath}" "${worker}" "${lock}" "${counter}" &`).join("\n");
  const r = spawnSync("sh", ["-c", `${launch}\nwait`], { encoding: "utf8" });
  assert.equal(r.status, 0, `子进程失败：${r.stderr}`);

  assert.equal(Number(readFileSync(counter, "utf8")), N,
    `${N} 个并发进程各加一次，计数器应为 ${N}；少于这个数说明互斥失效（无锁基线约为 9）`);
  assert.ok(!existsSync(lock), "所有进程结束后不得残留锁文件");
});

test("「文件不存在」不得走接管路径 —— 它和「内容损坏」含义相反", () => {
  // readHolder 把两者都返回 null，但不存在意味着持有者刚正常释放，下一轮
  // tryCreate 自然会赢。当成损坏而走接管路径，会 rename 走别人刚取得的锁再放回去，
  // 那一瞬的空窗被第三个进程抢到——实测 20 个并发 add 里有 2 个拿到重复的 rank。
  const p = lockPath();
  // 锁不存在：必须能直接取得，且不留下任何隔离文件
  assert.equal(withLock(p, () => "ok"), "ok");
  const dir = p.slice(0, p.lastIndexOf("/"));
  assert.deepEqual(
    readdirSync(dir).filter((f) => f.includes(".stale.") || f.endsWith(".tmp")),
    [],
    "正常路径不得产生隔离文件或临时文件",
  );
});
