// src/exec/run.ts
// 以**独立进程组**执行一条 shell 命令，超时时终止整棵树。
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
  stdout: string;
  stderr: string;
  durationMs: number;
  /** 输出是否被截断到 maxOutputBytes */
  truncated: boolean;
};

export type RunOptions = {
  cwd: string;
  /** 超时毫秒。不给则不超时 */
  timeoutMs?: number;
  /** SIGTERM 与 SIGKILL 之间的宽限窗口，默认 5 秒 */
  graceMs?: number;
  /** stdout / stderr 各自的上限，默认 1 MiB */
  maxOutputBytes?: number;
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
 * **代价**：`detached` 的子进程在 todopi 自己被 SIGKILL 时会变成孤儿。
 * 这与 F05 的租约同属「运行时状态可能被留下」那一类，接受它——没有它就没有
 * 任何办法够到孙进程（实测：默认方式下 `child.kill()` 之后孙进程仍然存活）。
 */
export function runCommand(command: string, opts: RunOptions): RunResult {
  if (process.platform === "win32") {
    // 不在没测过的情况下声称支持树终止。CI 只有 Ubuntu，Windows 是尽力而为，
    // 而一个杀不干净的树终止比明确不支持更糟——它会悄悄留下 worker。
    throw new Error(
      "verify is not supported on Windows yet: killing the whole process tree needs " +
      "taskkill /T /F, which is not implemented or tested here.",
    );
  }

  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const payload = JSON.stringify({
    command,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? null,
    graceMs: opts.graceMs ?? DEFAULT_GRACE_MS,
    maxOutputBytes,
  });

  const runner = join(import.meta.dirname, "runner.ts");
  const started = Date.now();
  const r = spawnSync(process.execPath, [runner, payload], {
    encoding: "utf8",
    // runner 的输出是一行 JSON，最坏情况是两份被截断到上限的文本加转义
    maxBuffer: maxOutputBytes * 4 + 64 * 1024,
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
