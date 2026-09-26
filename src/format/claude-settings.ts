// src/format/claude-settings.ts
// `setup claude` 往 Claude Code 的 settings.json 里合并两个钩子（PRD FR-A1、FR-A2；事件于 2026-09-26 重核，
// 见 PRD §17）：
//   - SessionStart（不设 matcher，覆盖 startup / resume / clear / compact / fork）→ `todopi prime --hook`。
//     压缩后的重新注入靠它的 `compact` 来源：文档写明 SessionStart 的 stdout 会作为上下文加进去；
//     PostCompact 虽然存在，却不在那张「stdout 进上下文」的事件表里。
//   - SessionEnd → `todopi handoff --check --hook`。
//
// 文件是用户的：别的键、别的钩子原样保留（不校验、不改）；权限位不变；我们的钩子已经在、能跑、且覆盖 startup 与
// compact 就什么都不写（幂等）；覆盖不全就只补缺的来源。要往里加东西的容器不对就拒绝、一个字节都不写：不是
// JSON 对象、`hooks` 不是对象（含显式 null）、要动的事件不是列表；文件是符号链接（原子替换会拆断链接）。

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

/**
 * 这个处理器是不是**我们装的、能跑的**那一个：标准形状（`type: "command"`、`command` 恰好是我们的命令），
 * 除此之外只允许不改变「会不会运行、输出进不进上下文」的键（timeout、statusMessage）。带 `if`（非工具事件上
 * 永不运行）、`async`（后台跑，输出不进上下文）或任何我们不认识的键的，一律不算——宁可再补一组标准的，也不
 * 把一个可能不跑的处理器当成装好（F14 评审三轮）。**不校验用户别的钩子**：那是 Claude Code 的事，我们只往
 * 数组末尾加一组，不会让它们变得更糟；去逐条校验，就是在手写一份 Claude Code 的设置校验器。
 */
function isOurs(h: unknown, command: string): boolean {
  if (!isObject(h) || h["type"] !== "command" || h["command"] !== command) return false;
  return Object.keys(h).every((k) => ["type", "command", "timeout", "statusMessage"].includes(k));
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
    const ours = groups.filter((g) => isObject(g) && (g["matcher"] === undefined || typeof g["matcher"] === "string")
      && Array.isArray(g["hooks"]) && g["hooks"].some((h) => isOurs(h, command)));
    if (ours.length === 0) {
      hooks[event] = [...groups, { hooks: [{ type: "command", command }] }];
      changed = true;
      continue;
    }
    // 已经装过：按**所有**组的覆盖并集算（两个组分别覆盖 startup 与 compact 也算覆盖了——评审二轮）。缺哪个
    // 必需来源就只补一组覆盖缺的那些：压缩后能注入，启动时也不会注入两遍。用户原来的组不动。
    const missing = (MUST_COVER[event] ?? []).filter((src) => !ours.some((g) => isObject(g) && matches(g["matcher"], src)));
    if (missing.length === 0) continue;
    // 一个必需来源都没覆盖（比如 matcher 是非法正则）：当成没装，补一组标准的（不带 matcher，覆盖全部来源）。
    const all = missing.length === (MUST_COVER[event] ?? []).length;
    hooks[event] = [...groups, all ? { hooks: [{ type: "command", command }] } : { matcher: missing.join("|"), hooks: [{ type: "command", command }] }];
    notes.push(`${path}: the existing ${event} hook running \`${command}\` did not cover ${missing.join(" and ")}; `
      + `added a group for ${missing.join("|")} so context is also injected there.`);
    changed = true;
  }
  if (!changed) return { status: "unchanged", notes };
  settings["hooks"] = hooks;
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify(settings, null, 2)}\n`, mode);
  return { status: existed ? "updated" : "created", notes };
}
