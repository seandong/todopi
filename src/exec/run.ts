// src/exec/run.ts
// 以**独立进程组**执行一条 shell 命令，超时时终止**整个进程组**。
// 与 fs/ 同级：只 import node:*，不认识 todopi 的格式。

import { spawnSync } from "node:child_process";
import { join } from "node:path";

export type RunResult = {
  /** 退出码；被信号杀死时为 null */
  code: number | null;
  /** 杀死它的信号；正常退出时为 null */
  signal: string | null;
  /** 是否因为超时被终止 */
  timedOut: boolean;
  /**
   * stdout 与 stderr 合到一路的尾部，最多 `maxOutputBytes` 字节。
   *
   * 合成一路而不是分成两段：分段要把其中一路整个留在内存里。**同一路内部保持
   * 顺序，两路之间的先后不保证**——它们是各自独立的管道，谁先被读到取决于事件
   * 循环。完整输出在 `logPath` 指的那个文件里；这里只是给人看的那一截。
   */
  output: string;
  durationMs: number;
  /** `output` 是否只是完整输出的尾部（完整的那份在日志文件里） */
  truncated: boolean;
  /** 日志没写成时说明原因；写成了为 null */
  logProblem: string | null;
};

export type RunOptions = {
  cwd: string;
  /** 超时毫秒。不给则不超时 */
  timeoutMs?: number;
  /** SIGTERM 与 SIGKILL 之间的宽限窗口，默认 5 秒 */
  graceMs?: number;
  /** 内存里保留的尾部上限，默认 1 MiB。完整输出不受它限制 */
  maxOutputBytes?: number;
  /**
   * 完整输出流式写到这个文件。不给则只保留尾部。
   *
   * 这一层只认路径字符串；`.todopi/.cache/verify/` 这个去处由调用方决定
   * （FR-D4a），`exec/` 不认识 todopi 的格式。
   */
  logPath?: string;
};

const DEFAULT_GRACE_MS = 5_000;
const DEFAULT_MAX_OUTPUT = 1024 * 1024;

/**
 * 执行 `verify`。调用方在执行前**原样打印**这一行命令（FR-D4）。
 *
 * 实际的建组、计时与升级终止在 `runner.ts` 里，这里同步等它。分成两个进程的
 * 理由写在那个文件的头部：`done` 在文件锁内串行执行，所以这个函数必须同步；
 * 而「独立进程组」只有 Node 的异步 spawn 支持。
 *
 * **承诺的是「终止这个进程组」，不是「终止整棵树」**，两条边界如实写在这里：
 *
 * 1. `detached` 的子进程在 todopi 自己被 SIGKILL 时会变成孤儿。这与 F05 的租约
 *    同属「运行时状态可能被留下」那一类，接受它——没有它就没有任何办法够到
 *    孙进程（实测：默认方式下 `child.kill()` 之后孙进程仍然存活）。
 * 2. **主动脱离进程组的后代杀不到。** 子进程若自己调 `setsid(2)`（或 Node 的
 *    `detached`）另起一个组，`kill(-pid)` 就够不着它了——实测确认过。这是进程组
 *    终止的固有边界，不是这里的缺陷：唯一的替代是遍历 `/proc` 或 `ps` 追整棵
 *    树，那在跨平台上既不可靠也有竞态（进程可能在我们读到它之前就 fork 了）。
 *    实际的 `verify`（`pnpm test`、`cargo test`）不会这么做；会这么做的是守护
 *    进程，而那类东西本来就不该出现在一条 `verify` 里。
 */
export function runCommand(command: string, opts: RunOptions): RunResult {
  if (process.platform === "win32") {
    // 不在没测过的情况下声称支持树终止。CI 只有 Ubuntu，Windows 是尽力而为，
    // 而一个杀不干净的树终止比明确不支持更糟——它会悄悄留下 worker。
    throw new Error(
      "verify is not supported on Windows yet: terminating the command's process " +
      "group needs taskkill /T /F, which is not implemented or tested here.",
    );
  }

  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const payload = JSON.stringify({
    command,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? null,
    graceMs: opts.graceMs ?? DEFAULT_GRACE_MS,
    maxOutputBytes,
    logPath: opts.logPath ?? null,
  });

  const runner = join(import.meta.dirname, "runner.ts");
  const started = Date.now();
  const r = spawnSync(process.execPath, [runner, payload], {
    encoding: "utf8",
    // runner 的输出是一行 JSON：一份不超过上限的尾部，最坏情况每个字节
    // 转义成 \uXXXX 六个字符
    maxBuffer: maxOutputBytes * 8 + 64 * 1024,
  });

  if (r.error !== undefined && r.error !== null) throw r.error;
  try {
    return JSON.parse(r.stdout) as RunResult;
  } catch {
    // runner 自己崩了。如实报告，别假装命令失败——两者要区分开。
    throw new Error(
      `Could not run the verify command: the runner exited ${r.status} ` +
      `after ${Date.now() - started}ms. stderr: ${(r.stderr ?? "").slice(0, 500)}`,
    );
  }
}
