// src/commands/board.ts
// FR-B2：看板的数据。一次读盘、一次建图，给每个可显示的任务建详情（Log 全量——抽屉里要看全部）。
// 只读：不取锁、不写文件、不刷心跳（看板开着不该让任何认领看起来还活着）。

import { hostname } from "node:os";
import { currentActor } from "./actor.ts";
import { isDisplayable, staleInputFor } from "./view.ts";
import { showOf, type ShowContext } from "./show.ts";
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { boardColumn, indexTasks, isReady } from "../domain/derive.ts";
import { validateFile } from "../domain/validate.ts";
import { sortTasks } from "../domain/order.ts";
import { toBoardDto, type BoardDto } from "../output/dto/board.ts";

export function runBoard(opts: { directory: string; actor?: string }): BoardDto {
  const ledger = discoverLedger(opts.directory);
  const all = readTasks(ledger);
  const invalid: string[] = [];
  const shown = all.filter((t) => {
    if (isDisplayable(validateFile(t))) return true;
    invalid.push(t.idFromFilename);
    return false;
  });
  // 图建在全部任务之上，理由同 ls。
  const ctx: ShowContext = {
    index: indexTasks(all),
    stale: staleInputFor(ledger),
    who: { actor: currentActor(ledger.root, opts.actor), host: hostname() },
  };
  const sorted = sortTasks(shown);
  return toBoardDto({
    root: ledger.root,
    tasks: sorted.map((t) => ({ show: showOf(ctx, t, { full: true }), column: boardColumn(ctx.index, t) })),
    ready: sorted.filter((t) => isReady(ctx.index, t, ctx.stale)).map((t) => t.idFromFilename),
    invalid: invalid.sort(),
  });
}
