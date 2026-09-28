// src/output/render/setup.ts

import type { SetupReport } from "../dto/setup.ts";
import { PLAIN, type Style } from "../style.ts";
import { action, diagnostic, shownPath, type Tone } from "./layout.ts";

const VERB: Record<SetupReport["files"][number]["status"], [verb: string, tone: Tone]> = {
  created: ["Created", "ok"],
  updated: ["Updated", "change"],
  appended: ["Appended", "change"],
  unchanged: ["Unchanged", "noop"],
};

/**
 * quiet 只去掉提示（信任、可能重复之类），不去掉结果——写了哪些文件（§8 的 --quiet）。
 * Cargo 式动作行（tp-rk6o8q）：项目级的文件给相对项目根的路径；用户级的（--user，写进家目录）给绝对路径，上色时缩成 ~。
 */
export function renderSetup(r: SetupReport, opts: { quiet?: boolean; style?: Style; home?: string; root?: string } = {}): string {
  const s = opts.style ?? PLAIN;
  const shown = (path: string) => r.scope === "project" && opts.root !== undefined && path.startsWith(`${opts.root}/`)
    ? path.slice(opts.root.length + 1)
    : shownPath(s, path, opts.home);
  const lines = r.files.map((f) => action(s, VERB[f.status][0], shown(f.path), VERB[f.status][1]));
  if (opts.quiet !== true) for (const n of r.notes) lines.push(diagnostic(s, "note", n));
  return `${lines.join("\n")}\n`;
}
