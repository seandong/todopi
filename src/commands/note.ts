// src/commands/note.ts
// FR-L1：`note <id> <text>` 追加一行 Log，支持多行文本。

import { writeAsWorker } from "./worker-write.ts";
import { statusOf } from "../domain/derive.ts";
import { verificationPending } from "../domain/verification-pending.ts";
import { EXIT, CliError } from "../exit.ts";

export type NoteOptions = {
  directory: string; id: string; actor?: string;
  text?: string; verifyPending?: string; clearVerifyPending?: boolean;
};
import type { NoteReport } from "../output/dto/worklog.ts";

/**
 * 统一换行、去掉首尾空行与行尾空白。空白的 note 拒绝——spec §5.3.3 的 `note` 行
 * 「text required」。
 *
 * 多行正文由 appendLogLine 按续行规则缩进两格；正文里的**空行**会变成两个空格
 * 而不是真空行——真空行会让读者（logEntries）把这一条提前截断。
 */
function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd()).join("\n")
    .replace(/^\n+/, "").replace(/\n+$/, "");
}

export function runNote(opts: NoteOptions): NoteReport {
  const ordinary = opts.text !== undefined;
  const pending = opts.verifyPending !== undefined;
  const clear = opts.clearVerifyPending === true;
  if (Number(ordinary) + Number(pending) + Number(clear) !== 1) {
    throw new CliError(EXIT.usage, "Provide either note text, --verify-pending <next-step>, or --clear-verify-pending.");
  }
  const text = ordinary ? normalize(opts.text!) : pending ? normalize(opts.verifyPending!) : "";
  if (!clear && text.trim() === "") throw new CliError(EXIT.usage, pending ? "A verification next step needs some text." : "A note needs some text.");

  // 普通 note 保持原行为：已关闭的任务也能补记教训；显式交接只允许当前持有者。
  const r = writeAsWorker(opts, (task, { now, actor }) => {
    if (pending || clear) {
      if (statusOf(task) !== "in_progress" || task.frontmatter["assignee"] !== actor) {
        throw new CliError(EXIT.usage, "Verification handoff needs an in-progress task assigned to this actor.");
      }
      if (clear && verificationPending(task) === null) return { noop: "no active verification handoff" };
    }
    const verb = pending ? "verify_pending" : clear ? "verify_cleared" : "note";
    return { appendLog: `${now} ${actor} ${verb}${clear ? "" : `: ${text}`}` };
  });
  return { id: opts.id, title: String(r.task.frontmatter["title"] ?? ""), text,
    ...(pending || clear ? { changed: r.wrote } : {}) };
}
