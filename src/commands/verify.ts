// src/commands/verify.ts
// 跑一个任务的 `verify`，并按 FR-D4a 安排输出的去向。
//
// 这一层是 exec/ 与 domain/ 之间的接线：exec/ 只认字符串与路径，domain/ 只认
// 已经算好的结果。信任、打印、落盘这些「和 todopi 有关但和进程无关」的事在这里。

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "../exec/run.ts";
import { isTrusted, recordTrust, trustFilePath } from "../exec/trust.ts";
import type { VerifyOutcome } from "../domain/gates.ts";
import type { Ledger } from "../format/discover.ts";
import { EXIT, CliError } from "../exit.ts";

/** 报告里给人看的尾部长度。完整输出在 `.cache/verify/` 里。 */
const TAIL_BYTES = 512;

export type VerifyOptions = {
  /** `--yes`：跳过首次确认（FR-D4） */
  yes?: boolean;
  /** 覆盖超时，给测试用；不给则读 config.yml 的 verify_timeout_seconds */
  timeoutMsOverride?: number;
};

/**
 * 首次在某个仓库执行 `verify` 前要求确认（FR-D4）。
 *
 * **非 TTY 且没给 `--yes` 时失败关闭，绝不挂起。** agent 在管道里跑 `done`，
 * 阻塞在一个没人看得见的提示上是最糟的结果——它会一直等到被杀，而现场看起来
 * 像是 verify 跑不完。
 *
 * `CI=true` 同样跳过：CI 里没有人可以回答。
 */
function ensureTrusted(ledger: Ledger, command: string, opts: VerifyOptions): void {
  if (isTrusted(ledger.root)) return;
  if (opts.yes === true || process.env["CI"] === "true") {
    recordTrust(ledger.root);
    return;
  }
  if (process.stdin.isTTY !== true) {
    throw new CliError(EXIT.gate,
      `This repository has not been trusted to run verify commands yet, and there is no ` +
      `terminal to ask on.\n` +
      `  The command that would run: ${command}\n` +
      `  Approve it once with \`todopi done <id> --yes\`, or set CI=true.\n` +
      `  Trust is recorded in ${trustFilePath()} — never inside the repository.`);
  }
  // 有终端时也不在这里读输入：v0.1 不做交互式提示（PRD §8 的命令表里没有），
  // 让人显式给 --yes，理由与上面同源——一次可见的批准好过一次看不见的等待。
  throw new CliError(EXIT.gate,
    `This repository has not been trusted to run verify commands yet.\n` +
    `  The command that would run: ${command}\n` +
    `  Approve it once with \`todopi done <id> --yes\`.\n` +
    `  Trust is recorded in ${trustFilePath()} — never inside the repository.`);
}

/**
 * 执行 `verify` 并返回结果。**完整输出一律落 `.todopi/.cache/verify/`**
 * （FR-D4a），那个目录由 `init` 写进 `.todopi/.gitignore`，不会被提交。
 *
 * 执行前**原样打印**命令（FR-D4）：它使这条命令永远不会和上次悄悄不同。
 * 打印走 stderr，`--json` 的 stdout 才保持可解析。
 */
export function runVerify(
  ledger: Ledger, id: string, command: string, opts: VerifyOptions,
): VerifyOutcome {
  ensureTrusted(ledger, command, opts);

  process.stderr.write(`Running verify for ${id}:\n  ${command}\n`);

  const timeoutMs = opts.timeoutMsOverride ?? ledger.config.verify_timeout_seconds * 1000;
  const result = runCommand(command, { cwd: ledger.root, timeoutMs });

  const dir = join(ledger.dir, ".cache", "verify");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = join(dir, `${id}-${stamp}.log`);
  writeFileSync(logPath, [
    `$ ${command}`,
    `exit: ${result.timedOut ? `timed out after ${timeoutMs}ms` : String(result.code)}`,
    result.truncated ? "(output was truncated; only the tail is kept)" : "",
    "",
    "--- stdout ---", result.stdout,
    "--- stderr ---", result.stderr,
  ].join("\n"));

  return {
    command,
    exitCode: result.code,
    signal: result.signal,
    timedOut: result.timedOut,
    tail: tailOf(`${result.stdout}${result.stderr}`, TAIL_BYTES),
    logPath,
  };
}

/** 尾部而不是头部：失败的原因通常在最后几行。 */
export function tailOf(text: string, bytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= bytes) return text;
  return buf.subarray(buf.length - bytes).toString("utf8");
}
