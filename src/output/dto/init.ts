// src/output/dto/init.ts
// --json 的对外契约。改字段名是破坏性变更（FR-Q3）。

export type InitReport = {
  /** 账本所在的目录（绝对路径） */
  root: string;
  /** 本次新建的文件，相对 root */
  created: string[];
  /** 已存在因而未被改动的文件 */
  kept: string[];
  /** AGENTS.md 发生了什么 */
  agents: "created" | "appended" | "replaced" | "unchanged";
};
