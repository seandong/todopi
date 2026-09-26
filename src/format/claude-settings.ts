// src/format/claude-settings.ts
// `setup claude` 往 Claude Code 的 settings.json 里合并两个钩子（PRD FR-A1、FR-A2；事件于 2026-09-26 重核，
// 见 PRD §17）：
//   - SessionStart（不设 matcher，覆盖 startup / resume / clear / compact / fork）→ `todopi prime --hook`。
//     压缩后的重新注入靠它的 `compact` 来源：文档写明 SessionStart 的 stdout 会作为上下文加进去；
//     PostCompact 虽然存在，却不在那张「stdout 进上下文」的事件表里。
//   - SessionEnd → `todopi handoff --check --hook`。
//
// 文件是用户的：别的键、别的钩子原样保留；我们的钩子已经在就什么都不写（幂等）；文件不是 JSON 对象、或
// `hooks` 的形状不对，就拒绝——不猜、不覆盖。

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "../fs/atomic.ts";
import { EXIT, CliError } from "../exit.ts";

export const CLAUDE_HOOKS: readonly (readonly [event: string, command: string])[] = [
  ["SessionStart", "todopi prime --hook"],
  ["SessionEnd", "todopi handoff --check --hook"],
];

export type SettingsResult = "created" | "updated" | "unchanged";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 这个事件下是否已经有一条 command 恰好是 `command` 的钩子（在任何一个 matcher 组里）。 */
function hasCommand(groups: unknown[], command: string): boolean {
  return groups.some((g) => isObject(g) && Array.isArray(g["hooks"])
    && g["hooks"].some((h) => isObject(h) && h["command"] === command));
}

export function ensureClaudeHooks(path: string): SettingsResult {
  const existed = existsSync(path);
  let settings: Record<string, unknown> = {};
  if (existed) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      throw new CliError(EXIT.usage, `${path} is not valid JSON (${err instanceof Error ? err.message : String(err)}); left untouched. Fix it, then run setup again.`);
    }
    if (!isObject(parsed)) throw new CliError(EXIT.usage, `${path} is not a JSON object; left untouched.`);
    settings = parsed;
  }
  const hooks = settings["hooks"] ?? {};
  if (!isObject(hooks)) throw new CliError(EXIT.usage, `${path} has a "hooks" entry that is not an object; left untouched.`);

  let changed = false;
  for (const [event, command] of CLAUDE_HOOKS) {
    const groups = hooks[event] ?? [];
    if (!Array.isArray(groups)) throw new CliError(EXIT.usage, `${path}: hooks.${event} is not a list; left untouched.`);
    if (hasCommand(groups, command)) continue;
    hooks[event] = [...groups, { hooks: [{ type: "command", command }] }];
    changed = true;
  }
  if (!changed) return "unchanged";
  settings["hooks"] = hooks;
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify(settings, null, 2)}\n`);
  return existed ? "updated" : "created";
}
