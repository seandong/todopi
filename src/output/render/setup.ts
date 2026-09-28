// src/output/render/setup.ts

import type { SetupReport } from "../dto/setup.ts";
import { PLAIN, type Style } from "../style.ts";

const tilde = (path: string, home: string | undefined) =>
  home !== undefined && home !== "" && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;

/**
 * quiet 只去掉提示（信任、可能重复之类），不去掉结果——写了哪些文件（§8 的 --quiet）。
 * 纯文本逐字节不变（e2e 与 agent 按 `^created <path>` 读）；上色时状态词上色、家目录缩成 ~、提示前加一个醒目的 !（tp-rk6o8q）。
 */
export function renderSetup(r: SetupReport, opts: { quiet?: boolean; style?: Style; home?: string } = {}): string {
  const s = opts.style ?? PLAIN;
  const styled = s !== PLAIN;
  const paint: Record<SetupReport["files"][number]["status"], (x: string) => string> = {
    created: s.green, updated: s.yellow, appended: s.yellow, unchanged: s.dim,
  };
  const lines = r.files.map((f) => `${paint[f.status](f.status)}${" ".repeat(Math.max(0, 9 - f.status.length))} ${styled ? tilde(f.path, opts.home) : f.path}`);
  if (opts.quiet !== true) for (const n of r.notes) lines.push(styled ? `${s.yellow("!")} ${n}` : n);
  return `${lines.join("\n")}\n`;
}
