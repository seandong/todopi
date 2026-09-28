// src/output/render/doctor.ts
// 两个渲染器共用同一个结果对象（src/ARCHITECTURE.md）。这样 --json 永远不会比人类
// 输出少信息——反过来，各拼各的最常见的 bug 就是「人类输出里有的提示，--json 里查不到」，
// 而这个 CLI 的主要用户是 agent。
//
// 本文件 MUST NOT import src/domain/（ARCH-008）。

import type { DoctorFixReport, DoctorReport, FindingDto } from "../dto/doctor.ts";
import { PLAIN, type Style } from "../style.ts";
import { action, diagnostic } from "./layout.ts";

export function renderJson(r: DoctorReport): string {
  return JSON.stringify(r, null, 2);
}

/**
  * quiet 只去掉**提示**，不去掉结果与错误。doctor 通过时的那一行是提示性的
  * （没有问题就没什么要报的）；发现问题时的每一条都是结果，quiet 不得吞掉它们。
  * Cargo 式（tp-rk6o8q）：通过时一行 Checked；有问题时按文件分组、规则名标红，最后一行 error: 小结。
  */
export function renderText(r: DoctorReport, opts: { quiet?: boolean; style?: Style } = {}): string {
  const s = opts.style ?? PLAIN;
  // 警告是结果，不是提示：quiet 也照出（它们不让 doctor 失败，但人得看见）。
  const warn = r.warnings.map((w) => `${diagnostic(s, "warning", `${w.path}: ${w.message}`)}\n`).join("");
  if (r.ok) {
    if (opts.quiet) return warn;
    return warn + `${r.scanned === 0
      ? action(s, "Checked", "0 tasks: the ledger is empty", "noop")
      : action(s, "Checked", `${r.scanned} task(s), no problems found`)}\n`;
  }
  const lines: string[] = [];
  const byPath = new Map<string, FindingDto[]>();
  for (const f of r.findings) {
    const list = byPath.get(f.path) ?? [];
    list.push(f);
    byPath.set(f.path, list);
  }
  for (const [path, findings] of byPath) {
    lines.push(s.bold(path));
    for (const f of findings) lines.push(`  ${s.red(f.rule)}  ${f.message}`);
  }
  lines.push("");
  lines.push(diagnostic(s, "error", `${r.scanned} task(s), ${r.findings.length} problem(s)`));
  return warn + lines.join("\n") + "\n";
}

export function renderFixText(r: DoctorFixReport, opts: { quiet?: boolean; style?: Style } = {}): string {
  const s = opts.style ?? PLAIN;
  const lines: string[] = [];
  for (const f of r.fixed) lines.push(action(s, "Fixed", `${f.path}: ${f.changes.join(", ")}`));
  for (const x of r.skipped) lines.push(action(s, "Skipped", `${x.path}: ${x.reason}`, "change"));
  for (const id of r.leasesCleared) lines.push(action(s, "Cleared", `expired lease ${id}`));
  if (lines.length === 0 && !opts.quiet) lines.push(action(s, "Unchanged", "nothing to normalize", "noop"));
  const head = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  return head + renderText(r.after, opts);
}
