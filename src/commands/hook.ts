// src/commands/hook.ts
// `prime --hook` / `handoff --hook`：被 agent 的钩子调用时的两件事（D032 当时留给 setup 任务的那一步）。
//
// 1. 会话 id 从钩子喂进 stdin 的 JSON 里取。Claude Code、Codex（与 Gemini CLI……）的载荷带 `session_id`；OpenCode 的
//    事件里 id 在 `properties.info.id`（session.created）或 `properties.sessionID`（session.compacted），由我们生成的
//    插件规范化成 `{"sessionID": …}` 再喂进来。三种拼法都认。取不到就返回 undefined，调用方
//    退回按 actor 记录——钩子里绝不因为载荷长得不对而失败。
// 2. 用户级钩子会在**每个**项目里触发，包括没有 `.todopi/` 的；那里什么都不输出、退出 0。

import { discoverLedger, findLedger } from "../format/discover.ts";
import { markCompacted, takeCompacted } from "../format/session.ts";
import { currentActor } from "./actor.ts";
import { EXIT, CliError } from "../exit.ts";

/** 从钩子载荷（stdin 的原文）里取会话 id。 */
export function sessionFromHookPayload(payload: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  // Cursor 的钩子载荷用 `conversation_id`（官方文档的公共字段表）。
  for (const key of ["session_id", "sessionID", "sessionId", "conversation_id"]) {
    const v = (parsed as Record<string, unknown>)[key];
    if (typeof v === "string" && v !== "") return v;
  }
  return undefined;
}

/**
 * 钩子载荷里的项目目录：Cursor 的公共字段 `workspace_roots`（官方文档）。多根工作区里账本不一定在第一个根，
 * 所以取**第一个找得到账本的根**（F17 评审）；都找不到就返回 undefined，调用方照常按工作目录找、找不到就静默。
 * 绝不抛。只认这一个字段：别家的钩子在项目目录里运行，工作目录就对。
 */
export function directoryFromHookPayload(payload: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const roots = (parsed as Record<string, unknown>)["workspace_roots"];
  if (!Array.isArray(roots)) return undefined;
  return roots.find((r): r is string => typeof r === "string" && r !== "" && findLedger(r) !== null);
}

/**
 * 有的 agent 要钩子以 JSON 返回注入的内容（D038）：Cursor 的 sessionStart 读 `additional_context`；Gemini CLI 的
 * SessionStart / BeforeAgent 读 `hookSpecificOutput.additionalContext`。`shape` 是 `cursor` 或 `gemini:<事件名>`。
 * 没有内容时什么都不输出（钩子的空输出就是「不注入」）。
 */
export function wrapHookOutput(shape: string, text: string): string {
  if (text.trim() === "") return "";
  if (shape === "cursor") return `${JSON.stringify({ additional_context: text })}\n`;
  const m = /^gemini:(SessionStart|BeforeAgent)$/.exec(shape);
  if (m !== null) return `${JSON.stringify({ hookSpecificOutput: { hookEventName: m[1], additionalContext: text } })}\n`;
  throw new CliError(EXIT.usage, `Unknown --hook-json shape ${JSON.stringify(shape)}; expected cursor, gemini:SessionStart or gemini:BeforeAgent.`);
}

/**
 * 压缩标记的两头（D038）：`mark` 在压缩前的钩子里打标记，不输出；`take` 在每轮之前的钩子里取走标记，返回这一轮要不要
 * 重新 prime。键与 prime 记录相同：有会话 id 用会话 id，没有用 actor。
 */
export function compactionGate(directory: string, mode: "mark" | "take", session?: string, actor?: string): boolean {
  const ledger = discoverLedger(directory);
  const key = session !== undefined ? { session } : { actor: currentActor(ledger.root, actor) };
  if (mode === "mark") { markCompacted(ledger, key); return false; }
  return takeCompacted(ledger, key);
}
