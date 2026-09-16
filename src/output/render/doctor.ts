// src/output/render/doctor.ts
// 两个渲染器共用同一个结果对象（src/ARCHITECTURE.md）。这样 --json 永远不会比人类
// 输出少信息——反过来，各拼各的最常见的 bug 就是「人类输出里有的提示，--json 里查不到」，
// 而这个 CLI 的主要用户是 agent。
//
// 本文件 MUST NOT import src/domain/（ARCH-008）。

import type { DoctorReport, FindingDto } from "../dto/doctor.ts";

export function renderJson(r: DoctorReport): string {
  return JSON.stringify(r, null, 2);
}

export function renderText(r: DoctorReport): string {
  if (r.ok) {
    return r.scanned === 0
      ? "doctor: 账本是空的，没有任务可检查。\n"
      : `doctor: ${r.scanned} 个任务，未发现问题。\n`;
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
  lines.push(`doctor: ${r.scanned} 个任务，${r.findings.length} 个问题。`);
  return lines.join("\n") + "\n";
}
