// src/commands/verify.ts
// 跑一个任务的 `verify`，并按 FR-D4a 安排输出的去向。
//
// 这一层是 exec/ 与 domain/ 之间的接线：exec/ 只认字符串与路径，domain/ 只认
// 已经算好的结果。信任、打印、落盘这些「和 todopi 有关但和进程无关」的事在这里。

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "../exec/run.ts";
import { isTrusted, recordTrust, trustFilePath } from "../exec/trust.ts";
import { canAsk, askYesNo } from "../exec/prompt.ts";
import { readTasks } from "../format/read.ts";
import { visible } from "../domain/visible.ts";
import type { VerifyOutcome } from "../domain/gates.ts";
import type { Ledger } from "../format/discover.ts";
import { EXIT, CliError } from "../exit.ts";
import { PLAIN } from "../output/style.ts";
import { action } from "../output/render/layout.ts";

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
    const problem = recordTrust(ledger.root);
    // 记不下来就别往下走：下次还会再问一遍，而这次的执行已经发生了——
    // 那种「批准了但没记住」的状态比直接失败更难查。
    if (problem !== null) throw new CliError(EXIT.usage, problem);
    return;
  }
  if (process.stdin.isTTY !== true) {
    throw new CliError(EXIT.gate,
      `This repository has not been trusted to run verify commands yet, and there is no ` +
      `terminal to ask on.\n` +
      `  The command that would run: ${visible(command)}\n` +
      `  Approve it once with \`todopi done <id> --yes\`, or set CI=true.\n` +
      `  Trust is recorded in ${trustFilePath()} — never inside the repository.`);
  }
  // 有终端时的当场确认在拿锁之前就问过了（confirmTrustBeforeLock）；走到这里说明 stderr 不是终端（输出被重定向，
  // 问题没人看得见），或者确认之后到拿锁之间信任记录没了。照旧要求显式的 --yes。
  throw new CliError(EXIT.gate,
    `This repository has not been trusted to run verify commands yet.\n` +
    `  The command that would run: ${visible(command)}\n` +
    `  Approve it once with \`todopi done <id> --yes\`.\n` +
    `  Trust is recorded in ${trustFilePath()} — never inside the repository.`);
}

/**
 * FR-D4 的当场确认（F26）：仓库还没被信任、要跑的任务有 verify、没给 --yes、不在 CI 里，且 stdin 与 stderr 都是终端时，
 * 原样给出命令问一次；答 y 才记下信任。**在拿账本锁之前调用**——verify 在锁里跑，锁里等人回答会让并发的写入者超时。
 * 其余情形（已信任、没有 verify、--yes、CI、没有终端）什么都不做，交给锁里的 ensureTrusted 照旧处理。
 */
export function confirmTrustBeforeLock(
  ledger: Ledger, id: string, opts: VerifyOptions,
  ask: { canAsk: () => boolean; askYesNo: (question: string) => boolean } = { canAsk, askYesNo },
): void {
  if (isTrusted(ledger.root) || opts.yes === true || process.env["CI"] === "true" || !ask.canAsk()) return;
  const task = readTasks(ledger).find((t) => t.idFromFilename === id);
  const command = task?.frontmatter["verify"];
  if (typeof command !== "string" || command.trim() === "") return;
  const yes = ask.askYesNo(
    `This repository has not been trusted to run verify commands yet. todopi done ${id} would run:\n  ${visible(command)}\n` +
    `Trust ${visible(ledger.root)} to run its verify commands? This is recorded in ${trustFilePath()}, never inside the repository.`);
  if (!yes) {
    throw new CliError(EXIT.gate, `Not approved: verify was not run and ${id} is unchanged. Run \`todopi done ${id}\` again to be asked again.`);
  }
  const problem = recordTrust(ledger.root);
  if (problem !== null) throw new CliError(EXIT.usage, problem);
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

  // 显示用可见转义（控制字符不交给终端解释）；执行的是原文
  // Cargo 式动作行（tp-rk6o8q）；stderr 不上色——它在 agent 跑 done 时同样进上下文，判定不值得为一行多一套
  process.stderr.write(`${action(PLAIN, "Verifying", `${id}  ${visible(command)}`)}\n`);

  // 路径先定下来再执行：日志是**边跑边写**的，不是跑完再写。于是 todopi 自己
  // 被杀、或者命令跑到一半炸掉时，已经产生的输出仍然留在盘上。
  const dir = join(ledger.dir, ".cache", "verify");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = join(dir, `${id}-${stamp}.log`);

  const timeoutMs = opts.timeoutMsOverride ?? ledger.config.verify_timeout_seconds * 1000;
  const result = runCommand(command, { cwd: ledger.root, timeoutMs, logPath });

  // 日志没写成不该让 verify 失败——命令确实跑了，结果是真的。说一声就好。
  if (result.logProblem !== null) {
    process.stderr.write(`  warning: ${result.logProblem}\n`);
  }

  return {
    command,
    exitCode: result.code,
    signal: result.signal,
    timedOut: result.timedOut,
    tail: tailOf(result.output, TAIL_BYTES),
    logPath,
    logProblem: result.logProblem,
  };
}

/** 尾部而不是头部：失败的原因通常在最后几行。 */
export function tailOf(text: string, bytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= bytes) return text;
  return buf.subarray(buf.length - bytes).toString("utf8");
}
