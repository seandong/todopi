// src/commands/hook.ts
// `prime --hook` / `handoff --hook`：被 agent 的钩子调用时的两件事（D032 当时留给 setup 任务的那一步）。
//
// 1. 会话 id 从钩子喂进 stdin 的 JSON 里取。各家拼法不同（PRD FR-P1b）：`session_id`（Claude Code、Codex、
//    Gemini CLI……），OpenCode 在事件对象上给 `session_id` 或 `sessionID`。取不到就返回 undefined，调用方
//    退回按 actor 记录——钩子里绝不因为载荷长得不对而失败。
// 2. 用户级钩子会在**每个**项目里触发，包括没有 `.todopi/` 的；那里什么都不输出、退出 0。

/** 从钩子载荷（stdin 的原文）里取会话 id。 */
export function sessionFromHookPayload(payload: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  for (const key of ["session_id", "sessionID", "sessionId"]) {
    const v = (parsed as Record<string, unknown>)[key];
    if (typeof v === "string" && v !== "") return v;
  }
  return undefined;
}
