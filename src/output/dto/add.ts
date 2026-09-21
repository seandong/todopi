// src/output/dto/add.ts
// --json 的对外契约。改字段名是破坏性变更（FR-Q3）。

export type AddReport = {
  id: string;
  title: string;
  /** 相对账本根目录的路径 */
  path: string;
  rank: string;
};
