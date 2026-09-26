// src/output/render/doctor.ts
// 两个渲染器共用同一个结果对象（src/ARCHITECTURE.md）。这样 --json 永远不会比人类
// 输出少信息——反过来，各拼各的最常见的 bug 就是「人类输出里有的提示，--json 里查不到」，
// 而这个 CLI 的主要用户是 agent。
//
// 本文件 MUST NOT import src/domain/（ARCH-008）。

import type { DoctorFixReport, DoctorReport, FindingDto } from "../dto/doctor.ts";

export function renderJson(r: DoctorReport): string {
  return JSON.stringify(r, null, 2);
}

/**
  * quiet 只去掉**提示**，不去掉结果与错误。doctor 通过时的那一行是提示性的
  * （没有问题就没什么要报的）；发现问题时的每一条都是结果，quiet 不得吞掉它们。
  */
export function renderText(r: DoctorReport, opts: { quiet?: boolean } = {}): string {
  if (r.ok) {
    if (opts.quiet) return "";
    return r.scanned === 0
      ? "doctor: the ledger is empty; no tasks to check.\n"
      : `doctor: ${r.scanned} task(s), no problems found.\n`;
  }
  const lines: string[] = [];
  const byPath = new Map<string, FindingDto[]>();
  for (const f of r.findings) {
    const list = byPath.get(f.path) ?? [];
    list.push(f);
    byPath.set(f.path, list);
  }
  for (const [path, findings] of byPath) {
    lines.push(path);
    for (const f of findings) lines.push(`  ${f.rule}  ${f.message}`);
  }
  lines.push("");
  lines.push(`doctor: ${r.scanned} task(s), ${r.findings.length} problem(s).`);
  return lines.join("\n") + "\n";
}

/** `doctor --fix`：先列修了什么，再是修完之后的 doctor 结果。 */
export function renderFixText(r: DoctorFixReport, opts: { quiet?: boolean } = {}): string {
  const lines: string[] = [];
  for (const f of r.fixed) lines.push(`fixed ${f.path}: ${f.changes.join(", ")}`);
  for (const s of r.skipped) lines.push(`not fixed ${s.path}: ${s.reason}`);
  for (const id of r.leasesCleared) lines.push(`cleared expired lease ${id}`);
  if (lines.length === 0 && !opts.quiet) lines.push("doctor --fix: nothing to normalize.");
  const head = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  return head + renderText(r.after, opts);
}
