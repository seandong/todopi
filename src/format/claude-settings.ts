// src/format/claude-settings.ts
// `setup claude` 往 Claude Code 的 settings.json 里合并两个钩子（PRD FR-A1、FR-A2；事件于 2026-09-26 重核，
// 见 PRD §17）：
//   - SessionStart（不设 matcher，覆盖 startup / resume / clear / compact / fork）→ `todopi prime --hook`。
//     压缩后的重新注入靠它的 `compact` 来源：文档写明 SessionStart 的 stdout 会作为上下文加进去；
//     PostCompact 虽然存在，却不在那张「stdout 进上下文」的事件表里。
//   - SessionEnd → `todopi handoff --check --hook`。
//
// 文件是用户的：别的键、别的钩子按 **JSON 值**原样保留（不校验、不改）；权限位不变；我们的标准组已经在就什么都
// 不写（幂等）。整份文件经 JSON.parse / JSON.stringify 重写：缩进与数字的原始写法不保留，超出双精度的数字会变成
// Claude Code 自己（同样用 JS 的 JSON.parse）读到的那个值——对它这个唯一的读者而言值不变（D035）。`-0` 会写成 `0`，两者视为同一个 JSON 数值。
// 要往里加东西的容器不对就拒绝、一个字节都不写：不是
// JSON 对象、`hooks` 不是对象（含显式 null）、要动的事件不是列表；文件是符号链接（原子替换会拆断链接）。

import { lstatSync, mkdirSync, readFileSync, type Stats } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "../fs/atomic.ts";
import { EXIT, CliError } from "../exit.ts";

export type HookList = readonly (readonly [event: string, command: string])[];

export const CLAUDE_HOOKS: HookList = [
  ["SessionStart", "todopi prime --hook"],
  ["SessionEnd", "todopi handoff --check --hook"],
];

/**
 * Codex 的 hooks.json 与 Claude Code 同构（官方文档；2026-09-26 在 Codex 0.157.1 上实测）：SessionStart 不设
 * matcher，压缩后以 `compact` 来源在下一轮前再触发、stdout 进上下文；PostCompact 也会触发——两个都装会注入两遍，
 * 所以只装 SessionStart（PRD §17）。
 */
export const CODEX_HOOKS: HookList = CLAUDE_HOOKS;

export type SettingsResult = { status: "created" | "updated" | "unchanged"; notes: string[] };

/** lstat，不存在返回 null（悬空的符号链接算存在）。 */
export function lstatOrNull(path: string): Stats | null {
  try { return lstatSync(path); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 这个组是不是**我们装的、能跑的、覆盖全部来源的**那一组——只认我们自己写出的形状，不去模拟 Claude Code 怎么
 * 解释 matcher（精确列表还是正则，F14 评审三、四轮各找出一种我猜错的写法）：
 *   - 组没有 matcher（或为空、为 `*`：官方文档里「匹配全部」的写法）——这样才覆盖 startup / resume / clear /
 *     compact / fork 全部来源；
 *   - 其中有一个处理器：`type: "command"`、`command` 恰好是我们的命令；除此之外只允许 `timeout`（正数）与
 *     `statusMessage`（字符串）。带 `if`（非工具事件上永不运行）、`async`（输出不进上下文）或任何陌生键的不算。
 * **不校验用户别的钩子**：那是 Claude Code 的事，我们只往数组末尾加一组，不会让它们变得更糟（D035）。
 */
function isOurGroup(g: unknown, command: string): boolean {
  if (!isObject(g) || !(g["matcher"] === undefined || g["matcher"] === "" || g["matcher"] === "*")) return false;
  return Array.isArray(g["hooks"]) && g["hooks"].some((h) => isObject(h) && h["type"] === "command" && h["command"] === command
    && Object.keys(h).every((k) => ["type", "command", "timeout", "statusMessage"].includes(k))
    && (h["timeout"] === undefined || (typeof h["timeout"] === "number" && h["timeout"] > 0))
    && (h["statusMessage"] === undefined || typeof h["statusMessage"] === "string"));
}

/** 用户自己限定过的同名组：不算装好，也不改它；提示一下它可能与我们的组重复注入。 */
function isNarrowedCopy(g: unknown, command: string): boolean {
  return isObject(g) && Array.isArray(g["hooks"]) && !isOurGroup(g, command)
    && g["hooks"].some((h) => isObject(h) && h["command"] === command);
}

function refuse(path: string, why: string): never {
  throw new CliError(EXIT.usage, `${path}: ${why}; left untouched. Fix it, then run setup again.`);
}

export function ensureClaudeHooks(path: string): SettingsResult {
  return ensureHookConfig(path, CLAUDE_HOOKS);
}

/** Claude Code 与 Codex 共用：往它们的 hooks JSON 里合并 `list` 里的钩子。 */
export function ensureHookConfig(path: string, list: HookList): SettingsResult {
  // 用 lstat 判断存在：existsSync 对悬空符号链接返回 false，会把链接本身当空位替换掉（F15 评审）。
  const link = lstatOrNull(path);
  if (link?.isSymbolicLink() === true) refuse(path, "is a symbolic link (replacing it would break the link)");
  const existed = link !== null;
  let settings: Record<string, unknown> = {};
  let mode: number | undefined;
  if (existed) {
    // 先核对字节：解码会把非法 UTF-8 静默换成 U+FFFD，写回就改掉了用户原来的内容（F14 评审五轮）。
    const bytes = readFileSync(path);
    const text = bytes.toString("utf8");
    if (!bytes.equals(Buffer.from(text, "utf8"))) refuse(path, "is not valid UTF-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
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
  for (const [event, command] of list) {
    if (event in hooks && !Array.isArray(hooks[event])) refuse(path, `hooks.${event} is not a list`);
    const groups: unknown[] = Array.isArray(hooks[event]) ? hooks[event] : [];
    if (groups.some((g) => isOurGroup(g, command))) continue;
    hooks[event] = [...groups, { hooks: [{ type: "command", command }] }];
    changed = true;
    if (groups.some((g) => isNarrowedCopy(g, command))) {
      notes.push(`${path}: an existing ${event} group also runs \`${command}\` but with a matcher or extra settings; `
        + "left as you configured it and added the standard group. If both match, it runs twice — remove one.");
    }
  }
  if (!changed) return { status: "unchanged", notes };
  settings["hooks"] = hooks;
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify(settings, null, 2)}\n`, mode);
  return { status: existed ? "updated" : "created", notes };
}
