// src/domain/types.ts
// 用 as const 数组加 typeof X[number] 代替 enum——Node 的类型剥离不做类型导向的
// 代码生成，enum 会在运行时报 SyntaxError（ARCH-013）。

export const STATUSES = ["open", "in_progress", "closed"] as const;
export type Status = (typeof STATUSES)[number];

export const RESOLUTIONS = ["done", "wontfix", "duplicate", "obsolete"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** 任务标识：spec §4 —— <prefix>-<六位 base36>。 */
export const ID_RE = /^[a-z][a-z0-9]{0,7}-[0-9a-z]{6}$/;
/** actor：spec §5.4。 */
export const ACTOR_RE = /^[^\s:]{1,64}$/;
/** 标签：spec §5.2 字段 10。 */
export const LABEL_RE = /^[a-z0-9][a-z0-9_.-]{0,31}$/;
/** rank：spec §5.2 字段 8。 */
export const RANK_RE = /^[0-9a-z]{1,32}$/;
/** 时间戳：RFC 3339、UTC、秒精度、Z 后缀。 */
export const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** 一个任务文件的原始读取结果。校验之前不做任何形状假设。 */
export type TaskFile = {
  /** 相对账本根目录的路径，用于报告 */
  path: string;
  /** 文件名去掉 .md —— 不变量 1 要拿它和 frontmatter.id 比对 */
  idFromFilename: string;
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
  /** 信封或 YAML 解析失败时的原因；非空时 frontmatter 是空对象 */
  parseError?: string;
};
