// src/commands/setup.ts
// FR-A1：`setup <agent> [--user]` 幂等地装好该 agent 的钩子与规则文件，打印写入的每个文件。
//
// 项目级（默认，克隆即用）：`<项目根>/.claude/settings.json` 与 `<项目根>/CLAUDE.md`。项目根就是 `.todopi/`
// 所在的目录——协议段在那里的 AGENTS.md 里（init 写的）。
// 用户级（--user）：钩子写进 `~/.claude/settings.json`。CLAUDE.md 的导入仍是项目的事（AGENTS.md 按项目存在）：
// 在账本里运行就照样确保项目的 CLAUDE.md，不在就跳过并说明。

import { homedir } from "node:os";
import { join } from "node:path";
import { findLedger } from "../format/discover.ts";
import { CLAUDE_HOOKS, CODEX_HOOKS, ensureCursorHooks, ensureGeminiSettings, ensureHookConfig } from "../format/claude-settings.ts";
import { ensureCursorRule } from "../format/cursor-rule.ts";
import { ensureOpencodePlugin } from "../format/opencode-plugin.ts";
import { ensurePiExtension } from "../format/pi-extension.ts";
import { assertInsideProject } from "../format/generated-file.ts";
import { ensureAgentsImport } from "../format/claude-md.ts";
import type { SetupReport } from "../output/dto/setup.ts";
import { EXIT, CliError } from "../exit.ts";

export type SetupOptions = { directory: string; agent: string; user?: boolean; home?: string };

export const AGENTS = ["claude", "codex", "opencode", "pi", "cursor", "gemini"] as const;

export function runSetup(opts: SetupOptions): SetupReport {
  if (!(AGENTS as readonly string[]).includes(opts.agent)) {
    throw new CliError(EXIT.usage, `Unknown or not yet supported agent ${JSON.stringify(opts.agent)}; supported: ${AGENTS.join(", ")}.`);
  }
  const ledger = findLedger(opts.directory);
  if (ledger === null && opts.user !== true) {
    throw new CliError(EXIT.usage, "No .todopi/ directory found here or above. Run \"todopi init\" first, or use --user for user-level hooks.");
  }
  const home = opts.home ?? homedir();
  // 项目级的目标必须真的落在项目里（路径上的目录可能是指向项目外的符号链接，F16 评审）。
  const at = (project: string[], user: string[]) => {
    if (opts.user === true) return join(home, ...user);
    const path = join(ledger!.root, ...project);
    assertInsideProject(ledger!.root, path);
    return path;
  };
  const files: SetupReport["files"] = [];
  const notes: string[] = [];

  if (opts.agent === "claude") {
    const r = ensureHookConfig(at([".claude", "settings.json"], [".claude", "settings.json"]), CLAUDE_HOOKS);
    files.push({ path: at([".claude", "settings.json"], [".claude", "settings.json"]), status: r.status });
    notes.push(...r.notes);
    // CLAUDE.md 的导入是项目的事（AGENTS.md 按项目存在）：在账本里就确保项目的 CLAUDE.md，不在就跳过并说明。
    if (ledger !== null) {
      const claudeMd = join(ledger.root, "CLAUDE.md");
      assertInsideProject(ledger.root, claudeMd);
      files.push({ path: claudeMd, status: ensureAgentsImport(claudeMd) });
    } else {
      notes.push("Not inside a todopi project, so no CLAUDE.md was touched; run setup in a project to add its @AGENTS.md import.");
    }
  } else if (opts.agent === "codex") {
    // Codex 原生读 AGENTS.md，不需要导入那一步。
    const path = at([".codex", "hooks.json"], [".codex", "hooks.json"]);
    const r = ensureHookConfig(path, CODEX_HOOKS);
    files.push({ path, status: r.status });
    notes.push(...r.notes);
    if (r.status !== "unchanged") {
      notes.push("Codex runs new or changed hooks only after you trust them: on its next start, choose to trust the hooks (or review them with /hooks).");
    }
  } else if (opts.agent === "opencode") {
    // OpenCode 原生读 AGENTS.md。
    const path = at([".opencode", "plugins", "todopi.js"], [".config", "opencode", "plugins", "todopi.js"]);
    files.push({ path, status: ensureOpencodePlugin(path) });
  } else if (opts.agent === "cursor") {
    // Cursor 原生读 AGENTS.md。钩子：会话开始注入、结束检查交接；压缩后靠始终生效的规则文件（D038）。
    const path = at([".cursor", "hooks.json"], [".cursor", "hooks.json"]);
    const r = ensureCursorHooks(path);
    files.push({ path, status: r.status });
    notes.push(...r.notes);
    // 用户级规则在 Cursor 的设置界面里，不是文件；规则文件只在项目里写。
    if (ledger !== null) {
      const rule = join(ledger.root, ".cursor", "rules", "todopi.mdc");
      assertInsideProject(ledger.root, rule);
      files.push({ path: rule, status: ensureCursorRule(rule) });
    } else {
      notes.push("Not inside a todopi project, so no .cursor/rules/todopi.mdc was written; run setup in a project to add the always-apply rule.");
    }
  } else if (opts.agent === "gemini") {
    // Gemini CLI 默认只读 GEMINI.md：同一个 settings.json 里确保 context.fileName 含 AGENTS.md（D038）。
    const path = at([".gemini", "settings.json"], [".gemini", "settings.json"]);
    const r = ensureGeminiSettings(path);
    files.push({ path, status: r.status });
    notes.push(...r.notes);
  } else {
    // pi 原生读 AGENTS.md。项目本地扩展要在项目被信任后才加载（pi 文档）。
    const path = at([".pi", "extensions", "todopi.ts"], [".pi", "agent", "extensions", "todopi.ts"]);
    const status = ensurePiExtension(path);
    files.push({ path, status });
    if (opts.user !== true && status !== "unchanged") {
      notes.push("pi loads project-local extensions only after you trust the project: accept the trust prompt on its next start.");
    }
  }
  return { agent: opts.agent, scope: opts.user === true ? "user" : "project", files, notes };
}
