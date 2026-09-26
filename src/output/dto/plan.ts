// src/output/dto/plan.ts
// 规划类命令（dep、move、edit）的对外契约。

export type DepReport = {
  id: string;
  op: "add" | "rm";
  on: string;
  /** false：边本来就在（add）或本来就不在（rm），什么都没写 */
  changed: boolean;
};

export type MoveReport = {
  id: string;
  /** 挪完之后的 rank */
  rank: string;
  /** false：它本来就在那儿，什么都没写 */
  changed: boolean;
};

export type EditReport = {
  id: string;
  /** 真的变了的字段，排序后；空数组表示什么都没写 */
  fields: string[];
};
