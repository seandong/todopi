// src/output/dto/worklog.ts
// note 与 check 的对外契约。两者都只是往一个任务上记一笔，放在一个文件里。

export type NoteReport = { id: string; title: string; text: string };

export type CheckReport = {
  id: string;
  /** 第几条标准（spec §5.3.2 的文档序号，从 1 开始） */
  n: number;
  text: string;
  /** 这次操作的目标状态：check 为 true，--undo 为 false */
  checked: boolean;
  /** false 表示它本来就是这个状态，什么都没写（幂等） */
  changed: boolean;
};
