import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { withLock } from "../../src/fs/lock.ts";

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
  assert.ok(!existsSync(p), "抛错路径也必须释放锁，否则账本被永久锁死");
});

test("持锁期间锁文件记录 pid、host 与时间", () => {
  const p = lockPath();
  withLock(p, () => {
    const h = JSON.parse(readFileSync(p, "utf8")) as { pid: number; host: string; at: string };
    assert.equal(h.pid, process.pid);
    assert.equal(h.host, hostname());
    assert.match(h.at, /^\d{4}-\d{2}-\d{2}T/);
  });
});

/** 早于宽限期的时间戳。 */
const longAgo = () => new Date(Date.now() - 120_000).toISOString();

test("接管死进程留下的陈旧锁", () => {
  const p = lockPath();
  writeFileSync(p, JSON.stringify({ pid: 999999, host: hostname(), at: longAgo(), nonce: "n1" }));
  assert.equal(withLock(p, () => "taken"), "taken");
});

test("死进程的锁若刚写下则不接管 —— 宽限期是 ABA 竞态的主要防线", () => {
  // 刚被取得的锁 at 是新的。不设宽限期的话，一把「看起来已死」的新锁会被立刻
  // 接管，而它可能正是别人在这一瞬刚取得的。
  const p = lockPath();
  writeFileSync(p, JSON.stringify({ pid: 999999, host: hostname(), at: new Date().toISOString(), nonce: "n1" }));
  assert.throws(() => withLock(p, () => undefined, { timeoutMs: 120 }), /lock/i);
});

test("stale-handoff：接管过程中出现新持有者时，不得删掉它的活锁", () => {
  // Codex review 指出的 ABA 竞态：B 判定 A 陈旧 → A 释放 → C 取得 → B 删掉 C 的锁。
  // 这里模拟「移走的不是预期的那把」这一步：锁里是一把**活着的**新锁，
  // 而 withLock 被告知去接管——它必须把锁放回去而不是据为己有。
  const p = lockPath();
  const live = { pid: process.pid, host: hostname(), at: new Date().toISOString(), nonce: "live" };
  writeFileSync(p, JSON.stringify(live));
  assert.throws(() => withLock(p, () => undefined, { timeoutMs: 150 }), /lock/i);
  const after = JSON.parse(readFileSync(p, "utf8")) as { nonce: string };
  assert.equal(after.nonce, "live", "活锁必须还在，且内容未被替换");
});

test("释放时确认锁还是自己的 —— 不删后继者的锁", () => {
  const p = lockPath();
  const stolen = { pid: process.pid, host: hostname(), at: new Date().toISOString(), nonce: "successor" };
  withLock(p, () => {
    // 模拟「我持锁期间被误判陈旧而遭接管」：锁已经换成别人的了
    writeFileSync(p, JSON.stringify(stolen));
  });
  assert.ok(existsSync(p), "后继者的锁必须还在");
  assert.equal((JSON.parse(readFileSync(p, "utf8")) as { nonce: string }).nonce, "successor");
});

test("接管内容损坏的锁 —— 否则一个坏文件会把账本永久锁死", () => {
  const p = lockPath();
  writeFileSync(p, "not json at all");
  assert.equal(withLock(p, () => "taken"), "taken");
});

test("不接管异主机的锁 —— pid 在别的机器上无意义", () => {
  const p = lockPath();
  writeFileSync(p, JSON.stringify({ pid: 1, host: "some-other-machine", at: longAgo(), nonce: "n1" }));
  assert.throws(() => withLock(p, () => undefined, { timeoutMs: 120 }), /lock/i);
});

test("不接管活着的本机进程的锁", () => {
  const p = lockPath();
  writeFileSync(p, JSON.stringify({ pid: process.pid, host: hostname(), at: longAgo(), nonce: "n1" }));
  assert.throws(() => withLock(p, () => undefined, { timeoutMs: 120 }), /lock/i);
});

test("锁目录不存在时自动创建 —— 首次 add 时 leases/ 还不存在", () => {
  const dir = mkdtempSync(join(tmpdir(), "todopi-lock-"));
  const p = join(dir, "deep", "nested", "lock");
  assert.equal(withLock(p, () => "ok"), "ok");
});

test("嵌套调用同一把锁会失败 —— 提醒实现不要在持锁中再取锁", () => {
  const p = lockPath();
  assert.throws(
    () => withLock(p, () => withLock(p, () => undefined, { timeoutMs: 120 })),
    /lock/i,
  );
  assert.ok(!existsSync(p), "外层的释放仍要发生");
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
