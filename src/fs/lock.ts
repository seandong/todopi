// src/fs/lock.ts
import { writeFileSync, linkSync, readFileSync, unlinkSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

export type LockHolder = {
  pid: number;
  host: string;
  at: string;
  /** 每次获取都不同。让「这把锁还是我的吗」可以被精确回答，而不是靠 pid+host+at
   *  猜——同一进程在同一秒内释放又重取会产生完全相同的三元组。 */
  nonce: string;
};

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
  const mine = acquire(lockPath, timeoutMs);
  // 进程被 SIGINT/SIGTERM 打断时也要释放。注册在获取之后、执行之前，
  // 否则一次 Ctrl-C 就会把账本永久锁死。
  //
  // 释放前确认锁还是自己的：若它已被后继者持有（我们被误判为陈旧而遭接管），
  // 无条件 unlink 会删掉别人的活锁。
  const release = () => {
    const current = readHolder(lockPath);
    if (current !== null && current.nonce !== mine.nonce) return;
    try { unlinkSync(lockPath); } catch { /* 已经被释放 */ }
  };
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

function acquire(lockPath: string, timeoutMs: number): LockHolder {
  const deadline = Date.now() + timeoutMs;
  mkdirSync(dirname(lockPath), { recursive: true });

  for (;;) {
    const mine = tryCreate(lockPath);
    if (mine !== null) return mine;

    const holder = readHolder(lockPath);

    // 「文件不存在」与「内容损坏」必须分开。readHolder 把两者都返回 null，
    // 但它们的含义相反：不存在意味着持有者刚刚正常释放——下一轮 tryCreate 自然
    // 会赢，**不能**去接管。当成损坏而走接管路径会 rename 走别人刚取得的锁，
    // 再放回去，那一瞬的空窗被第三个进程抢到——实测 20 个并发 add 里有 2 个
    // 拿到重复的 rank。
    if (holder === null && !existsSync(lockPath)) {
      continue;                        // 刚被释放，直接重试获取
    }

    // 内容损坏 → 当成陈旧锁。否则一个坏文件会把账本永久锁死，
    // 而用户没有任何办法知道该删哪个文件。损坏的锁没有 at 可比，
    // 所以宽限期对它不适用。
    if (holder === null || (!holderIsAlive(holder) && isOldEnoughToSteal(holder))) {
      evictStale(lockPath, holder);
      continue;
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
function tryCreate(lockPath: string): LockHolder | null {
  const holder: LockHolder = {
    pid: process.pid, host: hostname(), at: new Date().toISOString(), nonce: randomUUID(),
  };
  // 临时文件名带 nonce，避免两个进程（甚至同一进程的两次尝试）用同一个临时路径。
  const tmp = join(dirname(lockPath), `.lock.${holder.nonce}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(holder), "utf8");
    try {
      linkSync(tmp, lockPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return null;
      throw err;
    }
    return holder;
  } finally {
    try { unlinkSync(tmp); } catch { /* 可能压根没建起来 */ }
  }
}

/**
 * 一把陈旧锁至少要静置多久才允许接管。
 *
 * 这个宽限期是对 ABA 竞态的主要防线：刚被取得的锁 `at` 是新的，不满足这个条件，
 * 因此不会被误当成陈旧锁。它把「判定陈旧」与「真的很久没人动」绑在一起。
 */
const STALE_GRACE_MS = 30_000;

function isOldEnoughToSteal(h: LockHolder): boolean {
  const at = Date.parse(h.at);
  return Number.isNaN(at) || Date.now() - at >= STALE_GRACE_MS;
}

/**
 * 移走一把陈旧锁。
 *
 * 用 rename 而不是 unlink，因为 **rename 是原子的而 unlink 没有前置条件**。
 * 先前的实现是「读 → 比对 → unlink」，三步之间可以被插入：B 判定 A 已死、
 * 再次确认仍是 A、此时 A 释放且 C 取得新锁、B 那条 unlink 删掉了 C 的活锁。
 * 这个场景可复现（见 tests/fs/lock.test.ts 的 stale-handoff 用例）。
 *
 * 换成 rename 之后，抢着接管的多个进程里只有一个能把那个 inode 移走，其余拿到
 * ENOENT。移走之后我们检查隔离出来的内容：确实是预期的陈旧锁就丢弃；不是的话
 * 说明在这一瞬有人取得了新锁，把它放回去。
 *
 * 放回去仍有一个极窄的窗口（rename 到 link 之间锁文件不存在）。它需要三件事同时
 * 发生：持有者已死、静置超过 30 秒、且恰好在这几个系统调用之间有人取得新锁。
 * POSIX 的文件原语给不出无条件删除的比较-并-交换，这个残余窗口是已知且被记录的，
 * 不是被忽略的。spec §8 也把 lease 定义为 advisory——持久记录是提交进 git 的
 * status/assignee/updated 三元组。
 */
function evictStale(lockPath: string, expected: LockHolder | null): void {
  const quarantine = `${lockPath}.stale.${randomUUID()}`;
  try {
    renameSync(lockPath, quarantine);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;   // 别人先接管了
    throw err;
  }
  const moved = readHolder(quarantine);
  const wasExpected =
    (expected === null && moved === null) ||
    (expected !== null && moved !== null && moved.nonce === expected.nonce);
  if (wasExpected) {
    try { unlinkSync(quarantine); } catch { /* 已经不在了 */ }
    return;
  }
  // 移走的不是预期的那把——有人在这一瞬取得了新锁。放回去。
  try {
    linkSync(quarantine, lockPath);
  } catch { /* 已经有人重新取得了，丢弃隔离副本即可 */ }
  try { unlinkSync(quarantine); } catch { /* 已经不在了 */ }
}

function readHolder(lockPath: string): LockHolder | null {
  try {
    const raw = JSON.parse(readFileSync(lockPath, "utf8")) as unknown;
    if (raw === null || typeof raw !== "object") return null;
    const h = raw as Partial<LockHolder>;
    if (typeof h.pid !== "number" || typeof h.host !== "string") return null;
    return {
      pid: h.pid, host: h.host,
      at: typeof h.at === "string" ? h.at : "",
      nonce: typeof h.nonce === "string" ? h.nonce : "",
    };
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

/** 同步忙等。临界区是毫秒级的，异步会把整条命令变成异步而收益为零。 */
function sleep(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* spin */ }
}
