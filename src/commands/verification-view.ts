// 交接提示先转义再限制长度；完整下一步仍在任务 Log 中。
import { visible } from "../domain/visible.ts";
import { verificationPending } from "../domain/verification-pending.ts";
import type { TaskFile } from "../domain/types.ts";

export type VerificationHint = { nextStep: string; command: string };

export function boundedVisible(text: string, limit = 160): string {
  // 每个字符独立转义，边界不会切断 \xNN / \uNNNN；也不扫描过长的日志。
  let shown = "";
  let consumed = 0;
  for (const ch of text) {
    const escaped = visible(ch);
    if (shown.length + escaped.length > limit) break;
    shown += escaped;
    consumed += ch.length;
  }
  return consumed < text.length ? `${shown}…` : shown;
}

export function verificationHint(t: TaskFile): VerificationHint | null {
  const text = verificationPending(t);
  return text === null ? null : { nextStep: boundedVisible(text), command: `todopi show ${t.idFromFilename} --full` };
}
