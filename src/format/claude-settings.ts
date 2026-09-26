// src/format/claude-settings.ts
// `setup claude` 往 Claude Code 的 settings.json 里合并两个钩子（PRD FR-A1、FR-A2；事件于 2026-09-26 重核，
// 见 PRD §17）：
//   - SessionStart（不设 matcher，覆盖 startup / resume / clear / compact / fork）→ `todopi prime --hook`。
//     压缩后的重新注入靠它的 `compact` 来源：文档写明 SessionStart 的 stdout 会作为上下文加进去；
//     PostCompact 虽然存在，却不在那张「stdout 进上下文」的事件表里。
//   - SessionEnd → `todopi handoff --check --hook`。
//
// 文件是用户的：别的键、别的钩子原样保留；权限位不变；我们的钩子已经在就什么都不写（幂等）。拿不准的一律
// 拒绝、一个字节都不写（F14 评审）：不是 JSON 对象、`hooks` 或要动的事件是 null 或形状不对、组或处理器不是
// 对象、文件是符号链接（原子替换会把链接换成普通文件，拆断用户的配置管理）。

import { existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "../fs/atomic.ts";
import { EXIT, CliError } from "../exit.ts";

export const CLAUDE_HOOKS: readonly (readonly [event: string, command: string])[] = [
  ["SessionStart", "todopi prime --hook"],
  ["SessionEnd", "todopi handoff --check --hook"],
];

/** SessionStart 的五个来源（官方文档）。我们的组必须覆盖 startup 与 compact——后者是压缩后注入的唯一路径。 */
const MUST_COVER: Record<string, readonly string[]> = { SessionStart: ["startup", "compact"] };

export type SettingsResult = { status: "created" | "updated" | "unchanged"; notes: string[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** matcher 是否匹配某个来源：缺省、空串、`*` 匹配全部；否则按官方文档当作正则、整串匹配。 */
function matches(matcher: unknown, value: string): boolean {
  if (matcher === undefined || matcher === "" || matcher === "*") return true;
  if (typeof matcher !== "string") return false;
  try { return new RegExp(`^(?:${matcher})$`).test(value); } catch { return false; }
}

function refuse(path: string, why: string): never {
  throw new CliError(EXIT.usage, `${path}: ${why}; left untouched. Fix it, then run setup again.`);
}

export function ensureClaudeHooks(path: string): SettingsResult {
  const existed = existsSync(path);
  if (existed && lstatSync(path).isSymbolicLink()) refuse(path, "is a symbolic link (replacing it would break the link)");
  let settings: Record<string, unknown> = {};
  let mode: number | undefined;
  if (existed) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      refuse(path, `is not valid JSON (${err instanceof Error ? err.message : String(err)})`);
    }
    if (!isObject(parsed)) refuse(path, "is not a JSON object");
    settings = parsed;
    mode = lstatSync(path).mode;
  }
  // 缺失与显式 null 不是一回事：null 是用户写的，不能当成「没有」覆盖掉。
  if ("hooks" in settings && !isObject(settings["hooks"])) refuse(path, "has a \"hooks\" entry that is not an object");
  const hooks: Record<string, unknown> = isObject(settings["hooks"]) ? settings["hooks"] : {};

  const notes: string[] = [];
  let changed = false;
  for (const [event, command] of CLAUDE_HOOKS) {
    if (event in hooks && !Array.isArray(hooks[event])) refuse(path, `hooks.${event} is not a list`);
    const groups: unknown[] = Array.isArray(hooks[event]) ? hooks[event] : [];
    for (const g of groups) {
      if (!isObject(g) || !Array.isArray(g["hooks"]) || !g["hooks"].every(isObject)) {
        refuse(path, `hooks.${event} has an entry that is not a matcher group with a list of hook objects`);
      }
    }
    const ours = groups.filter((g) => isObject(g) && Array.isArray(g["hooks"])
      && g["hooks"].some((h) => isObject(h) && h["type"] === "command" && h["command"] === command));
    const need = MUST_COVER[event] ?? [];
    if (ours.some((g) => isObject(g) && need.every((src) => matches(g["matcher"], src)))) continue;
    if (ours.length > 0) {
      // 已经装过、但用户把它限定在一部分来源上：那是用户的选择，不改，也不再加一组（启动时就会注入两遍）。
      // 如实告诉他压缩后不会重新注入。
      notes.push(`${path}: the ${event} hook running \`${command}\` has a matcher that does not cover `
        + `${need.join(" and ")}; left as you configured it, but context will not be re-injected after compaction.`);
      continue;
    }
    hooks[event] = [...groups, { hooks: [{ type: "command", command }] }];
    changed = true;
  }
  if (!changed) return { status: "unchanged", notes };
  settings["hooks"] = hooks;
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify(settings, null, 2)}\n`, mode);
  return { status: existed ? "updated" : "created", notes };
}
