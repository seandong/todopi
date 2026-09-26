// src/output/dto/doctor.ts
// --json 的对外契约。这是 src/output/ 下唯一允许 import src/domain/ 的文件（ARCH-008）。
// 它只做字段搬运与改名，不做计算——一旦开始在这里算派生态或拼字符串，这一层就白分了。
//
// 改这里的字段名就是对外的破坏性变更，按 FR-Q3 要升 CLI 主版本。

import type { Finding } from "../../domain/findings.ts";

export type FindingDto = {
  rule: string;
  path: string;
  message: string;
};

export type DoctorReport = {
  ok: boolean;
  scanned: number;
  findings: FindingDto[];
};

export function toDoctorReport(scanned: number, findings: Finding[]): DoctorReport {
  return {
    ok: findings.length === 0,
    scanned,
    findings: findings.map((f) => ({ rule: f.rule, path: f.path, message: f.message })),
  };
}

/** `doctor --fix` 的结果：改了哪些文件、各改了什么，哪些没改成，清掉了哪些租约，以及修完之后的 doctor。 */
export type DoctorFixReport = {
  fixed: { path: string; changes: string[] }[];
  skipped: { path: string; reason: string }[];
  leasesCleared: string[];
  after: DoctorReport;
};
