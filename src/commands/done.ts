// src/commands/done.ts
import { discoverLedger } from "../format/discover.ts";
import { gitHead, gitDirty } from "../fs/git.ts";
import { runTransition, logLine, type TransitionOptions } from "./transition.ts";
import type { TransitionReport } from "../output/dto/gate.ts";

export type DoneOptions = Omit<TransitionOptions, "transition" | "resolution">;

export function runDone(opts: DoneOptions): TransitionReport {
  const root = discoverLedger(opts.directory).root;
  return runTransition({ ...opts, transition: "done" }, {
    frontmatter: (fm) => ({ ...fm, status: "closed", resolution: "done" }),
    logLine: (ctx) => {
      // spec §5.3.3 的 done 行：verify=… · commit=<sha7> · dirty=…
      // verify 在 F06 恒为 none（没有执行任何命令）；F07 会填 pass / fail。
      const args: Array<[string, string]> = [["verify", "none"]];
      // **拿不到就不写这两个 key**，不写 commit=unknown —— 一个假的 sha 比没有
      // 更坏：读日志的人会拿它去 checkout。
      const head = gitHead(root);
      if (head !== null) args.push(["commit", head]);
      const dirty = gitDirty(root);
      if (dirty !== null) args.push(["dirty", String(dirty)]);
      return logLine("done", args, ctx);
    },
    dropLease: true,
  });
}
