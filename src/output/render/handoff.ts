// src/output/render/handoff.ts
// handoff 的文本报告。只拼 DTO 里的值（与 prime 同一条规矩：渲染不生成内容）。

import type { HandoffReport } from "../dto/handoff.ts";

function section(title: string, rows: string[] | null, missing: string): string {
  if (rows === null) return `${title}\n${missing}`;
  return [title, ...(rows.length === 0 ? ["None."] : rows)].join("\n");
}

export function renderHandoff(r: HandoffReport): string {
  const noBase = r.baselineNote ?? "";
  const blocks = [
    `Handoff for ${r.actor} (last prime: ${r.primedAt ?? "never"})`,
    section("In progress with no log in the last hour:",
      r.quiet.map((t) => `- ${t.id} ${t.title} (${t.assignee}; last log ${t.lastLogAt ?? "none"})`), ""),
    section("Created since last prime:", r.created === null ? null : r.created.map((t) => `- ${t.id} ${t.title}`), noBase),
    section("Verify new or changed since last prime:",
      r.verifyChanged === null ? null
        : r.verifyChanged.map((t) => `- ${t.id} ${t.title}: ${t.state}${t.verify === null ? "" : ` \`${t.verify}\``}`), noBase),
  ];
  if (r.check) blocks.push("Check only: nothing was written.");
  else {
    blocks.push(section("Logged handoff:", r.logged.map((t) => `- ${t.id} ${t.title} (${t.summary})`), ""));
    if (r.skipped.length > 0) blocks.push(section("Skipped:", r.skipped.map((t) => `- ${t.id} ${t.title}: ${t.reason}`), ""));
    if (r.failed.length > 0) blocks.push(section("Could not log handoff:", r.failed.map((t) => `- ${t.id} ${t.title}: ${t.message} (exit ${t.code})`), ""));
  }
  return `${blocks.join("\n\n")}\n`;
}
