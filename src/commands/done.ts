// src/commands/done.ts
import { discoverLedger } from "../format/discover.ts";
import { gitHead, gitDirty } from "../fs/git.ts";
import { runTransition, logLine, type TransitionOptions } from "./transition.ts";
import { runVerify, tailOf } from "./verify.ts";
import type { TransitionReport } from "../output/dto/gate.ts";

/** FR-D4a：强制关闭时记进 Log 的输出长度。完整输出在 .cache/verify/。 */
const FORCED_TAIL_BYTES = 512;

export type DoneOptions = Omit<TransitionOptions, "transition" | "resolution"> & {
  /** --yes：首次在本仓库执行 verify 时跳过确认（FR-D4） */
  yes?: boolean;
  /** 覆盖 verify 超时，给测试用 */
  verifyTimeoutMs?: number;
};

export function runDone(opts: DoneOptions): TransitionReport {
  const ledger = discoverLedger(opts.directory);
  return runTransition({ ...opts, transition: "done" }, {
    runVerify: (task) => {
      const command = task.frontmatter["verify"];
      if (typeof command !== "string" || command.trim() === "") return undefined;
      return runVerify(ledger, task.idFromFilename, command, {
        yes: opts.yes,
        timeoutMsOverride: opts.verifyTimeoutMs,
      });
    },
    frontmatter: (fm) => ({ ...fm, status: "closed", resolution: "done" }),
    logLine: (ctx) => {
      // spec §5.3.3 的 done 行：verify=… · commit=<sha7> · dirty=…
      const outcome = ctx.verify;
      const verdict = outcome === undefined
        ? "none"                                    // 任务没有 verify 字段
        : outcome.timedOut || outcome.exitCode !== 0 ? "fail" : "pass";
      const args: Array<[string, string]> = [["verify", verdict]];
      // **拿不到就不写这两个 key**，不写 commit=unknown —— 一个假的 sha 比没有
      // 更坏：读日志的人会拿它去 checkout。
      const head = gitHead(ledger.root);
      if (head !== null) args.push(["commit", head]);
      const dirty = gitDirty(ledger.root);
      if (dirty !== null) args.push(["dirty", String(dirty)]);

      const line = logLine("done", args, ctx);
      // FR-D4a：**通过时不记录输出**（命令在 frontmatter 里、commit 在 Log 里，
      // 复现所需的一切都已具备）；**强制关闭时记最后 512 字节**，
      // 因为被越过的验证正是人必须复查的那一种，证据要留在 diff 里看得见。
      if (!ctx.forced || verdict !== "fail" || outcome === undefined) return line;
      const tail = tailOf(`${outcome.tail}`, FORCED_TAIL_BYTES).trimEnd();
      return tail === "" ? line : `${line}\n${tail}`;
    },
    dropLease: true,
  });
}
