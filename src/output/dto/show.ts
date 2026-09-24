// src/output/dto/show.ts
// show 的对外契约。--json 是**单个对象**：FR-T2 的「输出数组」只约束 ls。
//
// 在 TaskDto 之上加 show 才需要的东西：TaskDto 没有 verify 与 external，而 show
// 要显示全部 frontmatter（本仓库自举的任务，旧 id 就在 external 里）。
//
// 本文件只搬字段。Log 行的解析、父链的遍历、子任务的进度都由 commands/ 算好传进
// 来（ARCH-020：从 domain/ 只做类型导入）。

import type { TaskFile } from "../../domain/types.ts";
import type { Criterion } from "../../domain/acceptance.ts";
import type { LogEntry, ParsedLogLine } from "../../domain/validate.ts";
import { toTaskDto, type TaskDto, type TaskProjection } from "./ls.ts";

/** 树上的一个节点。`task` 缺席表示 parent 指向了一个不存在的 id。 */
export type TreeNode = {
  id: string;
  task?: TaskFile;
  progress?: { closed: number; total: number };
};

export type ShowProjection = {
  task: TaskProjection;
  acceptance: Criterion[];
  /** Acceptance Criteria 小节里不是标准的那些行，已剥掉首尾空行 */
  acceptanceNotes?: string;
  /** 已经截好的那几条（默认最近 5 条），各自带解析结果 */
  log: { entry: LogEntry; parsed: ParsedLogLine }[];
  logTotal: number;
  description?: string;
  plan?: string;
  tree?: { ancestors: TreeNode[]; children: TreeNode[]; cycle: boolean };
};

/**
 * 一条 Log。解析得通就拆成字段——`text` 已经把续行用 `\n` 并进来了
 * （spec §5.3.3）；解析不通的给原文并标 malformed，不假装它有结构。
 */
export type LogEntryDto =
  | { timestamp: string; actor: string; verb: string; args: Record<string, string>; text?: string }
  | { malformed: true; raw: string };

export type TreeNodeDto = {
  id: string;
  /** parent 指向的 id 在账本里不存在 */
  missing?: true;
  title?: string;
  status?: string;
  resolution?: string;
  child_progress?: { closed: number; total: number };
};

export type ShowDto = TaskDto & {
  verify?: string;
  external?: Record<string, unknown>;
  description?: string;
  plan?: string;
  acceptance: { n: number; text: string; checked: boolean }[];
  /**
   * Acceptance Criteria 小节里**不是**标准的内容（散文、嵌套项），原样。
   * 不进 `acceptance`：它们不编号、不参与 done 的门禁（spec §5.3.2）。
   */
  acceptance_notes?: string;
  /** 显示出来的那几条，时间顺序 */
  log: LogEntryDto[];
  /** Log 一共有几条（续行不算单独一条） */
  log_total: number;
  /** 只在 --tree 时出现 */
  tree?: {
    /** 从根到直接父任务 */
    ancestors: TreeNodeDto[];
    children: TreeNodeDto[];
    /** 沿 parent 往上走时绕回来了——那是 doctor 要报的不变量违规 */
    cycle: boolean;
  };
};

function node(n: TreeNode): TreeNodeDto {
  if (n.task === undefined) return { id: n.id, missing: true };
  const fm = n.task.frontmatter;
  const out: TreeNodeDto = { id: n.id };
  if (typeof fm["title"] === "string") out.title = fm["title"];
  if (typeof fm["status"] === "string") out.status = fm["status"];
  if (typeof fm["resolution"] === "string") out.resolution = fm["resolution"];
  if (n.progress !== undefined) out.child_progress = n.progress;
  return out;
}

function logDto(e: { entry: LogEntry; parsed: ParsedLogLine }): LogEntryDto {
  if (!e.parsed.ok) {
    return { malformed: true, raw: [e.entry.head, ...e.entry.continuation.map((l) => `  ${l}`)].join("\n") };
  }
  const { timestamp, actor, verb, args } = e.parsed;
  const parts = e.parsed.text === undefined ? e.entry.continuation : [e.parsed.text, ...e.entry.continuation];
  const out: LogEntryDto = { timestamp, actor, verb, args };
  if (parts.length > 0) out.text = parts.join("\n");
  return out;
}

export function toShowDto(p: ShowProjection): ShowDto {
  const fm = p.task.task.frontmatter;
  const dto: ShowDto = {
    ...toTaskDto(p.task),
    acceptance: p.acceptance.map((c) => ({ n: c.n, text: c.text, checked: c.checked })),
    log: p.log.map(logDto),
    log_total: p.logTotal,
  };
  if (p.acceptanceNotes !== undefined) dto.acceptance_notes = p.acceptanceNotes;
  if (typeof fm["verify"] === "string") dto.verify = fm["verify"];
  const ext = fm["external"];
  if (typeof ext === "object" && ext !== null && !Array.isArray(ext)) dto.external = ext as Record<string, unknown>;
  if (p.description !== undefined) dto.description = p.description;
  if (p.plan !== undefined) dto.plan = p.plan;
  if (p.tree !== undefined) {
    dto.tree = { ancestors: p.tree.ancestors.map(node), children: p.tree.children.map(node), cycle: p.tree.cycle };
  }
  return dto;
}
