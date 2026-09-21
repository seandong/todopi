// src/output/render/init.ts
// 本文件 MUST NOT import src/domain/（ARCH-008）。

import type { InitReport } from "../dto/init.ts";

export function renderJson(r: InitReport): string {
  return JSON.stringify(r, null, 2);
}

const AGENTS_NOTE: Record<InitReport["agents"], string> = {
  created: "已创建，含 todopi 协议",
  appended: "已追加 todopi 协议段落",
  replaced: "协议段落已更新",
  unchanged: "协议段落已是最新",
};

export function renderText(r: InitReport): string {
  const lines = [`账本：${r.root}/.todopi/`];
  // FR-A1 的要求同样适用于 init：打印写入的每个文件，用户要知道它动了什么。
  for (const f of r.created) lines.push(`  + ${f}`);
  for (const f of r.kept) lines.push(`  = ${f}（已存在，未改动）`);
  lines.push(`  AGENTS.md：${AGENTS_NOTE[r.agents]}`);
  lines.push("");
  lines.push('下一步：todopi add "第一个任务"');
  return lines.join("\n") + "\n";
}
