// src/exec/runner.ts
// `runCommand` 派出去的那个小进程。它负责：建组、计时、升级终止、把输出流式写进
// 日志文件，最后把结果作为一行 JSON 打到 stdout。
//
// **为什么要单独一个进程。** 调用方是一条一次性的 CLI 命令，整个 `done` 在文件锁
// 内串行执行，所以 `runCommand` 必须是同步的——否则锁的持有时间会变成另一件需要
// 论证的事。而「独立进程组」只有 Node 的**异步** spawn 支持（`detached: true`
// 底下是 setsid，`spawnSync` 没有这个选项）。于是把异步那部分关进一个子进程，
// 父进程用 `spawnSync` 同步等它。
//
// **输出不进内存。** 完整输出边跑边写进日志文件（FR-D4a），内存里只留一个有界的
// 尾部环。早先的版本把每个 chunk 攒进数组、退出时才 concat 再截尾——那个截尾只让
// 返回值变小，concat 之前的那份内存一直在涨，而日志也因此不再是「完整输出」。
//
// 走 .ts 而不是 .mjs：Node 22 的类型剥离直接跑 .ts，与仓库其余部分一致，
// 也一并受 tsc --noEmit 检查。

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";

type Payload = {
  command: string;
  cwd: string;
  timeoutMs: number | null;
  graceMs: number;
  maxOutputBytes: number;
  /** 完整输出写到哪；null 表示不落盘（只保留尾部） */
  logPath: string | null;
};

const payload = JSON.parse(process.argv[2] ?? "{}") as Payload;

/**
 * 有界的尾部环：只留最后 `max` 字节。**任何时刻**占用都不超过 `max` 加一个
 * chunk——这是「内存有界」这句话的全部依据，所以它必须自己成立，而不是靠
 * 「反正最后会截尾」。
 */
function makeTail(max: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  let dropped = false;
  return {
    push(c: Buffer): void {
      chunks.push(c);
      total += c.length;
      // 丢到「再丢一个就不够 max 了」为止，于是留下的恰好覆盖尾部 max 字节
      while (chunks.length > 1 && total - chunks[0]!.length >= max) {
        total -= chunks.shift()!.length;
        dropped = true;
      }
    },
    truncated(): boolean {
      return dropped || total > max;
    },
    text(): string {
      const all = Buffer.concat(chunks);
      if (all.length <= max) return all.toString("utf8");
      return all.subarray(all.length - max).toString("utf8");
    },
  };
}

const started = Date.now();
const tail = makeTail(payload.maxOutputBytes);

// 在 spawn **之前**开日志，否则头几个 chunk 会丢。
let log: WriteStream | null = null;
let logProblem: string | null = null;
if (payload.logPath !== null) {
  try {
    log = createWriteStream(payload.logPath, { flags: "w" });
    // 写不进去不该让 runner 崩掉——那会被上层当成「命令没跑起来」，
    // 而命令其实跑了。记下来，随结果一起报告。
    log.on("error", (e: NodeJS.ErrnoException) => {
      logProblem = `could not write the verify log to ${payload.logPath}: ${e.code ?? e.message}`;
    });
    log.write(`$ ${payload.command}\n\n`);
  } catch (e) {
    logProblem = `could not open the verify log at ${payload.logPath}: ${String(e)}`;
    log = null;
  }
}

// **detached: true** 让它自成进程组，于是 `process.kill(-pid, sig)` 够得着孙进程。
// 实测过：不加这个，`child.kill()` 之后孙进程仍然存活，而 `pnpm test` /
// `cargo test` 都会 fork worker（PRD FR-D2 的依据）。
//
// 命令原样交给 `sh -c`，不自己切分——`verify` 是用户写的一行 shell，
// 自己切等于重新实现一个 shell，而且和他在终端里敲的不是同一个东西。
const child = spawn("/bin/sh", ["-c", payload.command], {
  cwd: payload.cwd,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});

// **背压。** `pipe` 在目标写不动时暂停源，于是磁盘跟不上时子进程跟着慢下来，
// 而不是把 chunk 堆进流的内部缓冲——换个地方堆积不算有界。额外挂的 `data`
// 只是旁观同一批 chunk：源被 pause 时 `data` 也随之停，绕不过背压。
//
// 两路合写一个文件，所以日志是**交错**的。分成 stdout / stderr 两段就得把其中
// 一路整个留在内存里，而且会丢掉顺序——交错才是它当时的样子。
for (const s of [child.stdout, child.stderr]) {
  if (s === null) continue;
  if (log !== null) s.pipe(log, { end: false });
  s.on("data", (c: Buffer) => tail.push(c));
}

let timedOut = false;
let termTimer: NodeJS.Timeout | undefined;
let killTimer: NodeJS.Timeout | undefined;

/** 向**整个进程组**发信号。负 pid 就是「这个组」。 */
function signalGroup(sig: NodeJS.Signals): void {
  try {
    process.kill(-child.pid!, sig);
  } catch {
    // 组已经没了，或者建组失败（那就退回到只杀直接子进程）
    try { child.kill(sig); } catch { /* 已经退出 */ }
  }
}

if (payload.timeoutMs !== null) {
  termTimer = setTimeout(() => {
    timedOut = true;
    // **先 TERM 再 KILL。** 测试框架在 SIGTERM 上刷 coverage / junit；
    // 直接 SIGKILL 会丢掉那些，还留下半截文件，而半截文件会干扰下一次 verify。
    signalGroup("SIGTERM");
    killTimer = setTimeout(() => signalGroup("SIGKILL"), payload.graceMs);
  }, payload.timeoutMs);
}

let exited = false;
let closed = false;
let finished = false;
let exitCode: number | null = null;
let exitSignal: string | null = null;
let runError: string | null = null;
let capTimer: NodeJS.Timeout | undefined;

child.on("error", (e) => {
  runError = String(e);
  exited = true;
  maybeFinish(true);
});

child.on("exit", (code, signal) => {
  clearTimeout(termTimer);
  clearTimeout(killTimer);
  exitCode = code;
  exitSignal = signal;
  exited = true;
  // **正常退出后也清一次组，而且是立刻。** 直接子进程退出不等于整个组退出——
  // 跑完之后还活着的孙进程，和超时留下的一样是泄漏：它会继续占端口、写文件、
  // 烧 CPU。不能等 'close' 再杀：孙进程握着 stdout 管道时 'close' 要等它睡完。
  signalGroup("SIGKILL");
  // 等 stdio 关干净好让日志写全，但**有上限**：主动脱离进程组的后代杀不到，
  // 它握着管道时 'close' 永远不来。
  capTimer = setTimeout(() => maybeFinish(true), payload.graceMs);
  maybeFinish(false);
});

child.on("close", () => {
  closed = true;
  maybeFinish(false);
});

function maybeFinish(force: boolean): void {
  if (finished || !exited) return;
  if (!closed && !force) return;
  finished = true;
  clearTimeout(capTimer);
  finish();
}

function finish(): void {
  const how = runError !== null ? runError
    : timedOut ? `timed out after ${String(payload.timeoutMs)}ms`
    : exitSignal !== null ? `killed by ${exitSignal}`
    : String(exitCode);
  const json = JSON.stringify({
    code: exitCode,
    signal: exitSignal,
    timedOut,
    output: `${tail.text()}${runError ?? ""}`,
    durationMs: Date.now() - started,
    truncated: tail.truncated(),
    logProblem,
  });

  // stdout 对管道是异步的：紧跟着 process.exit 会截断这一行 JSON，而现在这行
  // 可以有 1 MiB。等它落地再退。
  let wrote = false;
  const emit = (): void => {
    if (wrote) return;
    wrote = true;
    process.stdout.write(json, () => process.exit(0));
  };

  if (log === null) { emit(); return; }
  log.end(`\n--- exit: ${how} (${String(Date.now() - started)}ms) ---\n`, emit);
  // 流坏掉时 end 的回调可能不来。别为了写日志把结果整个丢掉。
  setTimeout(emit, 2_000).unref();
}
