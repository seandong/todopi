// src/commands/note.ts
// FR-L1：`note <id> <text>` 追加一行 Log，支持多行文本。

import { writeAsWorker } from "./worker-write.ts";
import { EXIT, CliError } from "../exit.ts";

export type NoteOptions = { directory: string; id: string; text: string; actor?: string };
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
  const text = normalize(opts.text);
  if (text.trim() === "") throw new CliError(EXIT.usage, "A note needs some text.");

  // 已关闭的任务也可以 note：事后记一条教训正是 note 的用途。归属判定对已关闭任务
  // 不把文件里的 assignee 当持有者（domain/ownership.ts），共享租约照查。
  const r = writeAsWorker(opts, (_task, { now, actor }) => ({ appendLog: `${now} ${actor} note: ${text}` }));
  return { id: opts.id, title: String(r.task.frontmatter["title"] ?? ""), text };
}
