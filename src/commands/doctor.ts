// src/commands/doctor.ts
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { validateFile } from "../domain/validate.ts";
import { validateGraph } from "../domain/graph.ts";
import { toDoctorReport, type DoctorReport } from "../output/dto/doctor.ts";
import type { Finding } from "../domain/findings.ts";

export function runDoctor(opts: { directory: string }): DoctorReport {
  const ledger = discoverLedger(opts.directory);
  const tasks = readTasks(ledger);

  const findings: Finding[] = [];
  for (const t of tasks) findings.push(...validateFile(t));
  findings.push(...validateGraph(tasks));

  // 按路径再按规则排序，让输出在同一份账本上是确定的——不确定的输出没法写 e2e 断言。
  findings.sort((a, b) => (a.path === b.path ? a.rule.localeCompare(b.rule) : a.path.localeCompare(b.path)));

  return toDoctorReport(tasks.length, findings);
}
