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

/**
 * 第三项是组的 matcher：不给就是「匹配全部」的标准组；给了就只认 matcher 恰好等于它的组（Gemini 的 PreCompress）。
 * 第四项是旧版 setup 写的命令（F22 之前没有 `--agent`）：找到旧版的标准组就把命令就地改成新的，而不是再加一组——
 * 否则重跑 setup 之后新旧两组都在，prime 每次跑两遍。
 */
export type HookList = readonly (readonly [event: string, command: string, matcher?: string, legacy?: string])[];

/**
 * 每个钩子命令都带 `--agent <name>`（F22）：agent 给自己工具子进程设的环境变量（CLAUDECODE、CODEX_THREAD_ID……）不一定
 * 也出现在钩子子进程里，而钩子里的 prime / handoff 要与 agent 自己跑的 claim / done 得到同一个 actor（FR-C4）。
 */
function withAgent(agent: string, list: readonly (readonly [event: string, command: string, matcher?: string])[]): HookList {
  return list.map(([event, command, matcher]) => [event, command.replace(/^todopi /, `todopi --agent ${agent} `), matcher, command] as const);
}

const SESSION_HOOKS = [
  ["SessionStart", "todopi prime --hook"],
  ["SessionEnd", "todopi handoff --check --hook"],
] as const;

export const CLAUDE_HOOKS: HookList = withAgent("claude-code", SESSION_HOOKS);

/**
 * Codex 的 hooks.json 与 Claude Code 同构（官方文档；2026-09-26 在 Codex 0.157.1 上实测）：SessionStart 不设
 * matcher，压缩后以 `compact` 来源在下一轮前再触发、stdout 进上下文；PostCompact 也会触发——两个都装会注入两遍，
 * 所以只装 SessionStart（PRD §17）。
 */
export const CODEX_HOOKS: HookList = withAgent("codex", SESSION_HOOKS);

/**
 * Gemini CLI（0.26.0 源码为准，D038）：settings.json 的钩子结构与 Claude 同构，但注入要以 JSON 返回
 * `hookSpecificOutput.additionalContext`；没有「压缩后」事件，PreCompress 的返回值被压缩服务丢弃——所以压缩前只打标记，
 * 下一轮之前的 BeforeAgent 取走标记、重新注入（它的 additionalContext 追加进这一轮的请求）。
 * PreCompress 在每一次**尝试**时都触发，包括没到阈值、根本不压缩的自动检查（历史非空就每轮一次）；只有 `manual`
 * （/compress，强制压缩）一定真压缩了。所以这一组限定 matcher `manual`（对 PreCompress，matcher 与 trigger 精确
 * 比较）。自动压缩没有可靠的信号：靠系统指令里的 AGENTS.md 协议行「察觉到被压缩就跑 todopi prime」。
 */
export const GEMINI_HOOKS: HookList = withAgent("gemini", [
  ["SessionStart", "todopi prime --hook --hook-json gemini:SessionStart"],
  ["PreCompress", "todopi prime --hook --mark-compacted", "manual"],
  ["BeforeAgent", "todopi prime --hook --if-compacted --hook-json gemini:BeforeAgent"],
  ["SessionEnd", "todopi handoff --check --hook"],
]);

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
/** 组里的一个处理器是不是我们写出的标准形状（D035）。 */
function isStandardHandler(h: unknown, command: string): h is Record<string, unknown> {
  return isObject(h) && h["type"] === "command" && h["command"] === command
    && Object.keys(h).every((k) => ["type", "command", "timeout", "statusMessage"].includes(k))
    && (h["timeout"] === undefined || (typeof h["timeout"] === "number" && h["timeout"] > 0))
    && (h["statusMessage"] === undefined || typeof h["statusMessage"] === "string");
}

function isOurGroup(g: unknown, command: string, matcher?: string): boolean {
  if (!isObject(g)) return false;
  if (matcher !== undefined ? g["matcher"] !== matcher : !(g["matcher"] === undefined || g["matcher"] === "" || g["matcher"] === "*")) return false;
  return Array.isArray(g["hooks"]) && g["hooks"].some((h) => isStandardHandler(h, command));
}

/** 用户自己限定过的同名组：不算装好，也不改它；提示一下它可能与我们的组重复注入。 */
function isNarrowedCopy(g: unknown, command: string, matcher?: string): boolean {
  return isObject(g) && Array.isArray(g["hooks"]) && !isOurGroup(g, command, matcher)
    && g["hooks"].some((h) => isObject(h) && h["command"] === command);
}

function refuse(path: string, why: string): never {
  throw new CliError(EXIT.usage, `${path}: ${why}; left untouched. Fix it, then run setup again.`);
}

export function ensureClaudeHooks(path: string): SettingsResult {
  return ensureHookConfig(path, CLAUDE_HOOKS);
}

/** Claude Code 与 Codex 共用：往它们的 hooks JSON 里合并 `list` 里的钩子。 */
export function ensureHookConfig(path: string, list: HookList,
  extra?: (settings: Record<string, unknown>) => boolean): SettingsResult {
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
  for (const [event, command, matcher, legacy] of list) {
    if (event in hooks && !Array.isArray(hooks[event])) refuse(path, `hooks.${event} is not a list`);
    const groups: unknown[] = Array.isArray(hooks[event]) ? hooks[event] : [];
    const stillOld = (): boolean => legacy !== undefined && groups.some((g) => isObject(g) && Array.isArray(g["hooks"])
      && g["hooks"].some((x) => isObject(x) && x["command"] === legacy));
    if (groups.some((g) => isOurGroup(g, command, matcher))) {
      // 新版已经在：同一事件里若还有旧命令（被改过、没迁移的），照样提示——它也会跑，而且身份可能不同（Codex 评审）
      if (stillOld()) {
        notes.push(`${path}: a ${event} group still runs the old \`${legacy}\` alongside the current one; `
          + "if both run, prime runs twice — remove the old one.");
      }
      continue;
    }
    // 旧版 setup 的标准组：把那一项的命令就地改成新的（别的键、别的项原样）
    const old = legacy === undefined ? undefined : groups.find((g) => isOurGroup(g, legacy, matcher));
    if (old !== undefined && isObject(old) && Array.isArray(old["hooks"])) {
      // 只改那个标准形状的处理器：同组里被用户改过的同命令项（加了 if 之类）原样留着（Codex 评审）
      const h = old["hooks"].find((x) => isStandardHandler(x, legacy!));
      if (h !== undefined) {
        h["command"] = command;
        changed = true;
        if (old["hooks"].some((x) => isObject(x) && x["command"] === legacy)) {
          notes.push(`${path}: a ${event} group still runs the old \`${legacy}\` with settings of your own; left as you configured it. `
            + "The standard one was updated; if both run, prime runs twice — remove one.");
        }
        continue;
      }
    }
    const group = { hooks: [{ type: "command", command }] };
    hooks[event] = [...groups, matcher === undefined ? group : { matcher, ...group }];
    changed = true;
    if (groups.some((g) => isNarrowedCopy(g, command, matcher) || (legacy !== undefined && isNarrowedCopy(g, legacy, matcher)))) {
      notes.push(`${path}: an existing ${event} group also runs \`${command}\` but with a matcher or extra settings; `
        + "left as you configured it and added the standard group. If both match, it runs twice — remove one.");
    }
  }
  if (extra !== undefined && extra(settings)) changed = true;
  if (!changed) return { status: "unchanged", notes };
  settings["hooks"] = hooks;
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify(settings, null, 2)}\n`, mode);
  return { status: existed ? "updated" : "created", notes };
}

/**
 * Gemini CLI 默认只读 GEMINI.md；协议段在 AGENTS.md 里（init 写的）。确保 `context.fileName` 含 AGENTS.md——
 * 没设过就设成 ["AGENTS.md", "GEMINI.md"]（保留默认的 GEMINI.md），是字符串或数组就补上。上下文文件进系统指令，
 * 活过压缩；协议里「察觉到被压缩就跑 todopi prime」因此一直在（D038）。
 */
function includeAgentsMd(path: string): (settings: Record<string, unknown>) => boolean {
  return (settings) => {
    // 缺失与显式 null 不是一回事（与 hooks 同理，F17 评审）。
    const context = "context" in settings ? settings["context"] : {};
    if (!isObject(context)) refuse(path, "has a \"context\" entry that is not an object");
    const names = context["fileName"];
    let next: string[];
    if (names === undefined) next = ["AGENTS.md", "GEMINI.md"];
    else if (typeof names === "string") next = [names, "AGENTS.md"];
    else if (Array.isArray(names) && names.every((n) => typeof n === "string")) next = names.includes("AGENTS.md") ? names : [...names, "AGENTS.md"];
    else refuse(path, "has a context.fileName that is neither a string nor a list of strings");
    if (JSON.stringify(next) === JSON.stringify(names) || (typeof names === "string" && names === "AGENTS.md")) return false;
    settings["context"] = { ...context, fileName: next };
    return true;
  };
}

export function ensureGeminiSettings(path: string): SettingsResult {
  return ensureHookConfig(path, GEMINI_HOOKS, includeAgentsMd(path));
}

/**
 * Cursor 的 hooks.json 结构不同（官方文档）：`{"version": 1, "hooks": {"<事件>": [{"command": …}]}}`，没有 matcher 组。
 * sessionStart 的 `additional_context` 进初始上下文。preCompact 只能观察（不能改摘要）、beforeSubmitPrompt 不能注入——
 * 压缩后的指针靠始终生效的规则文件（D038）。判据与 D035 同：只认标准形状 `{command}`（只允许 timeout），别的原样保留。
 */
export const CURSOR_HOOKS: HookList = withAgent("cursor", [
  ["sessionStart", "todopi prime --hook --hook-json cursor"],
  ["sessionEnd", "todopi handoff --check --hook"],
]);

export function ensureCursorHooks(path: string): SettingsResult {
  const link = lstatOrNull(path);
  if (link?.isSymbolicLink() === true) refuse(path, "is a symbolic link (replacing it would break the link)");
  let settings: Record<string, unknown> = { version: 1, hooks: {} };
  let mode: number | undefined;
  if (link !== null) {
    const bytes = readFileSync(path);
    const text = bytes.toString("utf8");
    if (!bytes.equals(Buffer.from(text, "utf8"))) refuse(path, "is not valid UTF-8");
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch (err) { refuse(path, `is not valid JSON (${err instanceof Error ? err.message : String(err)})`); }
    if (!isObject(parsed)) refuse(path, "is not a JSON object");
    if (parsed["version"] !== 1) refuse(path, "does not declare \"version\": 1");
    settings = parsed;
    mode = link.mode;
  }
  if ("hooks" in settings && !isObject(settings["hooks"])) refuse(path, "has a \"hooks\" entry that is not an object");
  const hooks: Record<string, unknown> = isObject(settings["hooks"]) ? settings["hooks"] : {};
  let changed = false;
  const notes: string[] = [];
  const standard = (h: unknown, cmd: string | undefined): boolean => isObject(h) && h["command"] === cmd
    && Object.keys(h).every((k) => ["command", "timeout"].includes(k))
    && (h["timeout"] === undefined || (typeof h["timeout"] === "number" && h["timeout"] > 0));
  for (const [event, command, , legacy] of CURSOR_HOOKS) {
    if (event in hooks && !Array.isArray(hooks[event])) refuse(path, `hooks.${event} is not a list`);
    const entries: unknown[] = Array.isArray(hooks[event]) ? hooks[event] : [];
    if (entries.some((h) => standard(h, command))) {
      if (legacy !== undefined && entries.some((h) => isObject(h) && h["command"] === legacy)) {
        notes.push(`${path}: hooks.${event} still runs the old \`${legacy}\` alongside the current one; if both run, prime runs twice — remove the old one.`);
      }
      continue;
    }
    // 旧版 setup 写的那一项：就地改成新命令（F22）
    const old = entries.find((h) => standard(h, legacy));
    if (isObject(old)) { old["command"] = command; changed = true; continue; }
    if (legacy !== undefined && entries.some((h) => isObject(h) && h["command"] === legacy)) {
      notes.push(`${path}: hooks.${event} has the old \`${legacy}\` with settings of your own; left as is and added the current one. `
        + "If both run, prime runs twice — remove one.");
    }
    hooks[event] = [...entries, { command }];
    changed = true;
  }
  if (!changed) return { status: "unchanged", notes };
  settings["hooks"] = hooks;
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify(settings, null, 2)}\n`, mode);
  return { status: link === null ? "created" : "updated", notes };
}
