// src/commands/hook.ts
// `prime --hook` / `handoff --hook`：被 agent 的钩子调用时的两件事（D032 当时留给 setup 任务的那一步）。
//
// 1. 会话 id 从钩子喂进 stdin 的 JSON 里取。Claude Code、Codex（与 Gemini CLI……）的载荷带 `session_id`；OpenCode 的
//    事件里 id 在 `properties.info.id`（session.created）或 `properties.sessionID`（session.compacted），由我们生成的
//    插件规范化成 `{"sessionID": …}` 再喂进来。三种拼法都认。取不到就返回 undefined，调用方
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
