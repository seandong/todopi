// src/output/dto/board.ts
// `todopi web` 推给页面的数据（SSE 的每一条消息）。不是 --json 的公开 API，但照样只搬字段：列、ready 顺序都由
// commands/board.ts 算好传进来（ARCH-020）。

import type { ShowDto } from "./show.ts";

export type BoardTaskDto = ShowDto & { column: string };

export type BoardDto = {
  /** 账本所在的项目根，页面标题用 */
  root: string;
  /** spec §7.4 的顺序 */
  tasks: BoardTaskDto[];
  /** ready 队列的 id，spec §7.4 顺序（与 `ls --ready` 相同） */
  ready: string[];
  /** 不是合法 v1 任务文件的 id（同 ls 的 invalid），页面上提示去跑 doctor */
  invalid: string[];
};

export function toBoardDto(p: { root: string; tasks: { show: ShowDto; column: string }[]; ready: string[]; invalid: string[] }): BoardDto {
  return {
    root: p.root,
    tasks: p.tasks.map((t) => ({ ...t.show, column: t.column })),
    ready: p.ready,
    invalid: p.invalid,
  };
}
