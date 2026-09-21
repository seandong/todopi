// src/format/emit.ts
import { generateKeyBetween } from "fractional-indexing";

/** base36，与 spec §5.2 的 rank 正则 ^[0-9a-z]{1,32}$ 对齐。 */
const RANK_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** 字段顺序取自 spec §5.2 的表格。写入端按此发射，diff 才稳定。 */
const FIELD_ORDER = [
  "id", "title", "status", "resolution", "assignee", "parent",
  "blocked_by", "rank", "verify", "labels", "external", "created", "updated",
] as const;

export type NewTask = {
  id: string;
  title: string;
  status: string;
  rank: string;
  created: string;
  updated: string;
  parent?: string;
  blocked_by?: string[];
  verify?: string;
  labels?: string[];
  description?: string;
  acceptance?: string[];
  log: string[];
};

/**
 * 发射 frontmatter。**每个标量都加双引号**（spec §5.1）。
 *
 * 这条规则是 2026-09-15 那次规格评审的核心产出：不加引号时
 * `title: feat: add login` 让整个文件解析失败、`title: fix #42` 被静默截断成
 * "fix"、`rank: 007` 变成整数 7。而「一个任务≈一次提交」意味着标题按惯例带冒号，
 * 这是常态不是边界。加引号是消除歧义，而不是枚举它的情况。
 *
 * 未知键（包括 x-*）按 §5.2 必须被保留：它们排在已知字段之后，
 * 顺序保持调用方给的顺序。
 */
export function emitFrontmatter(fm: Record<string, unknown>): string {
  const lines: string[] = [];
  const known = new Set<string>(FIELD_ORDER);
  const emit = (key: string, value: unknown) => {
    if (value === undefined) return;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => quote(String(v))).join(", ")}]`);
      return;
    }
    if (value !== null && typeof value === "object") {
      // external 这类嵌套映射超出规范形态，本发射器不产生它们。
      // 保留它们是 F10 edit 的事（读到什么写回什么），那时走完整的 YAML 发射。
      // 现在抛错比悄悄写出半个结构好。
      throw new Error(`emitFrontmatter cannot emit a nested value for "${key}"`);
    }
    lines.push(`${key}: ${quote(String(value))}`);
  };
  for (const key of FIELD_ORDER) if (key in fm) emit(key, fm[key]);
  for (const key of Object.keys(fm)) if (!known.has(key)) emit(key, fm[key]);
  return lines.join("\n") + "\n";
}

/**
 * 只转义 \ 与 " —— 与 format/scan.ts 的快路径认得的两种转义严格对应。
 * 顺序要紧：先替换反斜杠再替换引号，反过来会把刚插入的反斜杠再转义一次。
 */
function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** 发射一个完整的任务文件。正文小节按 spec §5.3 的顺序，空的不发射。 */
export function emitTask(t: NewTask): string {
  const fm: Record<string, unknown> = {
    id: t.id, title: t.title, status: t.status, parent: t.parent,
    blocked_by: t.blocked_by && t.blocked_by.length > 0 ? t.blocked_by : undefined,
    rank: t.rank, verify: t.verify,
    labels: t.labels && t.labels.length > 0 ? t.labels : undefined,
    created: t.created, updated: t.updated,
  };
  const parts = ["---", emitFrontmatter(fm).trimEnd(), "---", ""];
  if (t.description) parts.push("## Description", "", t.description, "");
  if (t.acceptance && t.acceptance.length > 0) {
    parts.push("## Acceptance Criteria", "", ...t.acceptance.map((a) => `- [ ] ${a}`), "");
  }
  parts.push("## Log", "", ...t.log.map((l) => `- ${l}`), "");
  return parts.join("\n");
}

/**
 * 下一个 rank：追加到末尾。
 *
 * spec §7.4 与 FR-T1：创建时就分配 rank，使「有 rank」与「无 rank」的混合种群
 * 在正常路径下不存在——否则 `move X --after Y`（Y 无 rank）在规范内无解。
 * 在两个键之间插入是 move 的事（F10），本 feature 用不到。
 */
export function nextRank(lastRank: string | null): string {
  return generateKeyBetween(lastRank, null, RANK_ALPHABET);
}
