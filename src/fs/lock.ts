// src/fs/lock.ts
import { writeFileSync, linkSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { hostname } from "node:os";

export type LockHolder = { pid: number; host: string; at: string };

export type LockOptions = {
  /** 拿不到锁时等多久放弃。默认 5 秒——一次 add 的临界区是毫秒级的。 */
  timeoutMs?: number;
};

/**
 * 排他锁。spec §8：写入者 MUST 在任务文件的读-校验-写期间持有它。
 *
 * 不用 proper-lockfile：它的核心是 setInterval 心跳，撞 ARCH-002 与「无常驻进程」
 * 原则。而我们的锁按 spec §8 是**机器本地**的，可以用 kill(pid, 0) 精确判活，
 * 比 mtime 猜测准（DECISIONS D006 决策 5）。
 */
export function withLock<T>(lockPath: string, fn: () => T, opts: LockOptions = {}): T {
  const timeoutMs = opts.timeoutMs ?? 5000;
  acquire(lockPath, timeoutMs);
  // 进程被 SIGINT/SIGTERM 打断时也要释放。注册在获取之后、执行之前，
  // 否则一次 Ctrl-C 就会把账本永久锁死。
  const release = () => { try { unlinkSync(lockPath); } catch { /* 已经被释放 */ } };
  const onSignal = () => { release(); process.exit(130); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    return fn();
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    release();
  }
}

function acquire(lockPath: string, timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs;
  mkdirSync(dirname(lockPath), { recursive: true });

  for (;;) {
    if (tryCreate(lockPath)) return;

    const holder = readHolder(lockPath);
    // 内容损坏 → 当成陈旧锁。否则一个坏文件会把账本永久锁死，
    // 而用户没有任何办法知道该删哪个文件。
    if (holder === null || !holderIsAlive(holder)) {
      // 只删我们刚读到的那一把：持有者可能在这两步之间正常释放并被别人重新获取，
      // 那种情况下删掉的就是别人的锁。比对内容再删。
      if (removeIfUnchanged(lockPath, holder)) continue;
    }

    if (Date.now() >= deadline) {
      const who = holder ? `${holder.host}:${holder.pid} since ${holder.at}` : "an unreadable lock file";
      throw new Error(
        `Could not acquire the ledger lock at ${lockPath} within ${timeoutMs}ms; held by ${who}. ` +
          `If that process is gone, remove the file and try again.`,
      );
    }
    sleep(15);
  }
}

/**
 * 获取锁：先把内容写进临时文件，再 link 到锁路径。
 *
 * **不能用 `openSync(path, "wx")` 然后 writeSync**——那是两步，中间那一瞬锁文件
 * 存在但内容是空的。别的进程此时读到 ""，`JSON.parse` 抛错，按「损坏的锁当成陈旧锁」
 * 的规则把这把刚合法获取的锁删掉，于是两个进程同时进入临界区。
 *
 * 实测过这个 bug：30 个并发进程在锁内做 +1，计数器只到 15（无锁基线 9）。
 * 10 个单元测试全绿——它们都是单进程的，测不出这条竞态。
 *
 * link 在目标已存在时抛 EEXIST，与 O_EXCL 同样互斥，但锁文件从存在的第一刻
 * 内容就是完整的。
 */
function tryCreate(lockPath: string): boolean {
  const holder: LockHolder = { pid: process.pid, host: hostname(), at: new Date().toISOString() };
  // 临时文件名带 pid，避免两个进程用同一个临时路径互相覆盖。
  const tmp = join(dirname(lockPath), `.lock.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(holder), "utf8");
    try {
      linkSync(tmp, lockPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw err;
    }
    return true;
  } finally {
    try { unlinkSync(tmp); } catch { /* 可能压根没建起来 */ }
  }
}

function readHolder(lockPath: string): LockHolder | null {
  try {
    const raw = JSON.parse(readFileSync(lockPath, "utf8")) as unknown;
    if (raw === null || typeof raw !== "object") return null;
    const h = raw as Partial<LockHolder>;
    if (typeof h.pid !== "number" || typeof h.host !== "string") return null;
    return { pid: h.pid, host: h.host, at: typeof h.at === "string" ? h.at : "" };
  } catch {
    return null;                      // 文件不存在、或内容不是合法 JSON
  }
}

/**
 * 持有者还活着吗。
 *
 * 异主机的锁一律视为活着：pid 是本机概念，拿另一台机器的 pid 去 kill(pid, 0)
 * 问的是「本机有没有这个 pid」，答案与那台机器的实际状态无关。
 */
function holderIsAlive(h: LockHolder): boolean {
  if (h.host !== hostname()) return true;
  try {
    process.kill(h.pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";   // 存在但无权限
  }
}

function removeIfUnchanged(lockPath: string, expected: LockHolder | null): boolean {
  const current = readHolder(lockPath);
  const same =
    (expected === null && current === null) ||
    (expected !== null && current !== null &&
      current.pid === expected.pid && current.host === expected.host && current.at === expected.at);
  if (!same) return false;
  try { unlinkSync(lockPath); return true; } catch { return false; }
}

/** 同步忙等。临界区是毫秒级的，异步会把整条命令变成异步而收益为零。 */
function sleep(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* spin */ }
}
