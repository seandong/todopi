// src/commands/setup.ts
// FR-A1：`setup <agent> [--user]` 幂等地装好该 agent 的钩子与规则文件，打印写入的每个文件。目前只有 claude。
//
// 项目级（默认，克隆即用）：`<项目根>/.claude/settings.json` 与 `<项目根>/CLAUDE.md`。项目根就是 `.todopi/`
// 所在的目录——协议段在那里的 AGENTS.md 里（init 写的）。
// 用户级（--user）：钩子写进 `~/.claude/settings.json`。CLAUDE.md 的导入仍是项目的事（AGENTS.md 按项目存在）：
// 在账本里运行就照样确保项目的 CLAUDE.md，不在就跳过并说明。

import { homedir } from "node:os";
import { join } from "node:path";
import { findLedger } from "../format/discover.ts";
import { ensureClaudeHooks } from "../format/claude-settings.ts";
import { ensureAgentsImport } from "../format/claude-md.ts";
import type { SetupReport } from "../output/dto/setup.ts";
import { EXIT, CliError } from "../exit.ts";

export type SetupOptions = { directory: string; agent: string; user?: boolean; home?: string };

export const AGENTS = ["claude"] as const;

export function runSetup(opts: SetupOptions): SetupReport {
  if (opts.agent !== "claude") {
    throw new CliError(EXIT.usage, `Unknown or not yet supported agent ${JSON.stringify(opts.agent)}; supported: ${AGENTS.join(", ")}.`);
  }
  const ledger = findLedger(opts.directory);
  if (ledger === null && opts.user !== true) {
    throw new CliError(EXIT.usage, "No .todopi/ directory found here or above. Run \"todopi init\" first, or use --user for user-level hooks.");
  }
  const files: SetupReport["files"] = [];
  const settings = opts.user === true
    ? join(opts.home ?? homedir(), ".claude", "settings.json")
    : join(ledger!.root, ".claude", "settings.json");
  files.push({ path: settings, status: ensureClaudeHooks(settings) });
  const notes: string[] = [];
  if (ledger !== null) {
    const claudeMd = join(ledger.root, "CLAUDE.md");
    files.push({ path: claudeMd, status: ensureAgentsImport(claudeMd) });
  } else {
    notes.push("Not inside a todopi project, so no CLAUDE.md was touched; run setup in a project to add its @AGENTS.md import.");
  }
  return { agent: "claude", scope: opts.user === true ? "user" : "project", files, notes };
}
