// src/fs/lock.ts
import { writeFileSync, linkSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

/**
 * 锁被占用。**中性错误**——`fs/` 只 import `node:*`，不认识 CLI 的退出码协议
 * （ARCHITECTURE.md）。把它映射成 `CliError(EXIT.conflict)` 是 `commands/` 的事。
 *
 * 带上结构化的 `lockPath` 与 `holder`，调用方才能自己决定怎么呈现，
 * 而不是从消息文本里再解析一遍。
 */
export class LockBusyError extends Error {
  readonly lockPath: string;
  readonly holder: LockHolder | null;
  readonly holderAlive: boolean;
  constructor(message: string, lockPath: string, holder: LockHolder | null, holderAlive: boolean) {
    super(message);
    this.name = "LockBusyError";
    this.lockPath = lockPath;
    this.holder = holder;
    this.holderAlive = holderAlive;
  }
}

/**
 * 把路径包成 POSIX shell 里可安全粘贴的单个参数。
 *
 * 打印 `rm ${path}` 而不引用是危险的：路径含空格会让 rm 收到多个参数、
 * 含 glob 字符会展开成别的文件。单引号里除了单引号本身没有元字符，
 * 所以只需把 ' 换成 '\'' 这个惯用写法。
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export type LockHolder = {
  pid: number;
  host: string;
  at: string;
  /** 每次获取都不同。让「这把锁还是我的吗」可以被精确回答，而不是靠 pid+host+at
   *  猜——同一进程在同一秒内释放又重取会产生完全相同的三元组。 */
  nonce: string;
};

export type LockOptions = {
  /** 拿不到锁时等多久放弃。默认 5 秒——一次写入的临界区是毫秒级的。 */
  timeoutMs?: number;
};

/**
 * 排他锁。spec §8：写入者 MUST 在任务文件的读-校验-写期间持有它。
 *
 * ## 为什么它不自动接管陈旧的锁
 *
 * 只有 link / rename / unlink 这几个原语时，**无法原子地「仅当 X 具有属性 P 时
 * 删除 X」**。任何接管方案都要先判定陈旧、再删除，而这两步之间原持有者可能已经
 * 释放、新持有者可能已经取得——删掉的就是一把活锁。
 *
 * 2026-09-21 试过三种写法，每一种都被实测打败：
 *
 * 1. 读 → 比对 → unlink：比对与删除之间有窗口，删掉后继者的锁。
 * 2. 换成原子 rename 到隔离路径再判断：移走的若是活锁就「放回去」，而 rename 到
 *    link 之间的空窗又被第三个进程抢到。20 个并发 add 只产出 18 个不同 rank。
 * 3. 加 existsSync 区分「不存在」与「损坏」：两次系统调用之间仍可插入新持有者。
 *    复审时实测复现，20 个任务 19 个不同 rank。
 *
 * 所以这里不接管。锁被占用时就是被占用——等待，超时，报出持有者是谁、进程还在
 * 不在、以及怎么清理。清理陈旧租约是 `doctor --fix` 的职责（PRD FR-Q1），
 * 那是用户的显式动作，不是一次竞态。
 *
 * 代价：进程被 SIGKILL 或断电时会留下一把锁，需要 `doctor --fix` 或人工清理。
 * SIGINT / SIGTERM 已由下面的信号处理器覆盖，而临界区只有毫秒级，恰好在那一瞬
 * 被 SIGKILL 是罕见的。用「罕见且可诊断的停滞」换「无法排除的静默双持锁」，
 * 在一个以账本可信为唯一卖点的产品里是划算的。
 *
 * 也不用 proper-lockfile：它靠 setInterval 心跳把接管窗口压到心跳周期内，
 * 而 ARCH-002 与「无常驻进程」原则不允许心跳（DECISIONS D006 决策 5）。
 */
export function withLock<T>(lockPath: string, fn: () => T, opts: LockOptions = {}): T {
  const timeoutMs = opts.timeoutMs ?? 5000;

  // 信号处理器必须在**获取之前**注册。注册在获取之后的话，信号恰好落在
  // 「link 成功」与「注册完成」之间时，进程按默认行为退出并留下一把锁。
  // 窗口虽窄，但它正是 SIGKILL 之外唯一会留下残锁的路径——而那条路径是
  // 这个设计（不接管）唯一的代价，不该再自己放大它。
  let mine: LockHolder | null = null;
  const release = () => {
    if (mine === null) return;        // 还没拿到锁，没什么可释放的
    // 释放前确认锁还是自己的。本实现不接管，所以正常情况下它一定是自己的；
    // 这条检查防的是外部（用户手工 rm、将来的 doctor --fix）在我们持锁期间清掉了
    // 它，而此时又有别人取得了新锁——无条件 unlink 会删掉那把活锁。
    //
    // 读与删之间仍有一个窗口：POSIX 给不出「仅当内容是 X 时删除」。它比无条件
    // 删除严格更好，但不是零。触发它需要外部在一个毫秒级临界区内恰好清锁，
    // 而那种外部干预本身已经破坏了互斥——这条检查只是不再雪上加霜。
    const current = readHolder(lockPath);
    if (current !== null && current.nonce !== mine.nonce) return;
    try {
      unlinkSync(lockPath);
    } catch {
      // 已经被释放
    }
  };
  // 临界区是**同步**的，所以信号在它执行期间无法送达——Node 的信号处理器跑在
  // 事件循环上，而同步代码把事件循环堵死了。实测（Node 22）：
  //
  //   不注册处理器 → 同步期间被 OS 立即杀死，退出 143，**锁留在原地**
  //   注册处理器   → 信号被推迟；同步活干完、finally 释放锁，进程退出 0
  //
  // 注册它换来的是「锁一定被释放」，代价是**退出码变成 0 而不是 143**：
  // 处理器的回调还排在事件循环里，而主模块此时已经跑完，Node 不会再去派发它。
  // 试过在 finally 里按标志重发——标志永远是 false，因为处理器压根没跑过。
  //
  // 这个偏差被记录而不是被掩盖。它的代价边界很清楚：临界区是毫秒级的，
  // supervisor 看到的是「进程在 10ms 内退出，状态 0 而非 143」；
  // 换来的是不会留下一把需要人工清理的锁——而那正是「不接管」这个设计的唯一代价，
  // 不该再自己放大它。
  const onSignal = (signal: NodeJS.Signals) => {
    release();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.kill(process.pid, signal);      // 恢复默认行为并重新发给自己
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    mine = acquire(lockPath, timeoutMs);
    return fn();
  } finally {
    // **不在这里移除监听器。** 同步临界区期间到达的信号，此刻处理器还没跑过
    // （事件循环一直被堵着），它的回调还排在队列里。在这里 off 掉就等于把那个
    // 回调丢弃——信号被吞，进程以 0 退出。实测过：这正是「注册但不重发」那一档。
    //
    // 留着它是安全的：release 通过 mine 的 nonce 判断，锁已释放时它是空操作；
    // withLock 返回之后再来的信号会走处理器、release 空转、然后重发，
    // 效果与「没有处理器」完全一致。这个 CLI 一条命令只取一次锁，不会堆积。
    release();
    mine = null;                            // 之后再触发的 release 变成空操作
  }
}

function acquire(lockPath: string, timeoutMs: number): LockHolder {
  const deadline = Date.now() + timeoutMs;
  mkdirSync(dirname(lockPath), { recursive: true });

  for (;;) {
    const mine = tryCreate(lockPath);
    if (mine !== null) return mine;
    if (Date.now() >= deadline) throw lockBusy(lockPath, timeoutMs);
    sleep(15);
  }
}

/**
 * 获取锁：先把内容写进临时文件，再 link 到锁路径。
 *
 * **不能用 `openSync(path, "wx")` 然后 writeSync**——那是两步，中间那一瞬锁文件
 * 存在但内容是空的，读到的进程会以为它损坏了。link 在目标已存在时抛 EEXIST，
 * 与 O_EXCL 同样互斥，但锁文件从存在的第一刻内容就是完整的。
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
    try {
      unlinkSync(tmp);
    } catch {
      // 可能压根没建起来
    }
  }
}

/**
 * 超时时的错误。它是用户能拿到的唯一线索，所以必须说清三件事：
 * 谁持有、那个进程还在不在、怎么清理。
 */
function lockBusy(lockPath: string, timeoutMs: number): LockBusyError {
  const holder = readHolder(lockPath);
  if (holder === null) {
    return new LockBusyError(
      `Could not acquire the ledger lock at ${lockPath} within ${timeoutMs}ms. ` +
        `The lock file exists but its contents are unreadable, so it cannot be attributed ` +
        `to any process. If no other todopi command is running, delete it:\n  rm ${shellQuote(lockPath)}`,
      lockPath, null, false,
    );
  }
  // 只探测一次存活。探两次的话，持有进程恰在两次之间退出会让诊断与补救文字互相矛盾。
  const alive = holderIsAlive(holder);
  const liveness = alive
    ? holder.host === hostname()
      ? `process ${holder.pid} is still running`
      : `it is on another machine, so this process cannot tell whether it is still running`
    : `process ${holder.pid} is no longer running, so this lock is stale`;
  // 补救措施必须是**今天就能执行**的。doctor --fix 要到 F13 才有，在那之前
  // 指向它等于什么也没说——一个自主运行的 agent 会每轮等 5 秒然后永久失败。
  const remedy = alive
    ? `Wait for it to finish, or re-run with a longer timeout.`
    : `That process is gone, so this lock is safe to delete:\n  rm ${shellQuote(lockPath)}`;
  return new LockBusyError(
    `Could not acquire the ledger lock at ${lockPath} within ${timeoutMs}ms. ` +
      `Held by ${holder.host}:${holder.pid} since ${holder.at}; ${liveness}.\n${remedy}\n` +
      `This command never steals a lock: deciding one is stale and removing it cannot be ` +
      `done as a single atomic step, so an automatic takeover can always delete a live lock.`,
    lockPath, holder, alive,
  );
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
 * 持有者还活着吗。只用于**诊断信息**，不用于决定是否接管——本实现不接管。
 *
 * 异主机的锁一律视为活着：pid 是本机概念，拿另一台机器的 pid 去 kill(pid, 0)
 * 问的是「本机有没有这个 pid」，答案与那台机器的实际状态无关。
 */
export function holderIsAlive(h: LockHolder): boolean {
  if (h.host !== hostname()) return true;
  try {
    process.kill(h.pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";   // 存在但无权限
  }
}

/** 读一把锁的持有者信息，供 doctor 报告与 doctor --fix 清理使用（F13）。 */
export function inspectLock(lockPath: string): LockHolder | null {
  return readHolder(lockPath);
}

/** 同步忙等。临界区是毫秒级的，异步会把整条命令变成异步而收益为零。 */
function sleep(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* spin */ }
}
