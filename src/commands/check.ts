// src/commands/check.ts
// FR-D1：`check <id> <n>` / `--undo` 切换第 n 条验收标准并留痕（spec §5.3.2、§5.3.3）。

import { writeAsWorker } from "./worker-write.ts";
import { criterionLogText, flipCriterion, parseAcceptance } from "../domain/acceptance.ts";
import { statusOf } from "../domain/derive.ts";
import { EXIT, CliError } from "../exit.ts";

export type CheckOptions = { directory: string; id: string; n: number; undo?: boolean; actor?: string };
import type { CheckReport } from "../output/dto/worklog.ts";

/**
 * 把 `<n>` 的**原始字符串**解析成正整数。与 ls 的 `--limit` 同一个教训（F04）：
 * `Number.parseInt` 会把 "1.5" 读成 1、"0x2" 读成 0，勾到一条没人想勾的标准上。
 */
export function parseCriterionNumber(raw: string): number {
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new CliError(EXIT.usage, `The criterion number must be a whole number from 1 up; got ${JSON.stringify(raw)}.`);
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) throw new CliError(EXIT.usage, `The criterion number is too large: ${JSON.stringify(raw)}.`);
  return n;
}

export function runCheck(opts: CheckOptions): CheckReport {
  const target = opts.undo !== true;
  let picked = { text: "", n: opts.n };

  const r = writeAsWorker(opts, (task, { now, actor }) => {
    // **已关闭的任务不能改勾选。** done 的验收门禁是按关闭那一刻的勾选状态放行的，
    // 事后翻转等于改写那份证据。要改，先 reopen——那会留下一条记录。
    if (statusOf(task) === "closed") {
      throw new CliError(EXIT.gate,
        `Task ${opts.id} is closed; its acceptance criteria are the record of what was accepted. `
        + `Reopen it first with \`todopi reopen ${opts.id}\` if they need to change.`);
    }
    const criteria = parseAcceptance(task.body);
    const c = criteria[opts.n - 1];
    if (c === undefined) {
      throw new CliError(EXIT.usage, criteria.length === 0
        ? `Task ${opts.id} has no acceptance criteria to check.`
        : `Task ${opts.id} has ${criteria.length} acceptance criteria; there is no #${opts.n}.`);
    }
    picked = { text: c.text, n: c.n };
    // **幂等。** 已经是目标状态就什么都不写：意图已经达成，报错会让在循环里重跑的
    // agent 平白失败；写一行又会在 Log 里留下一个没发生过的事件。
    if (c.checked === target) return { noop: target ? "already checked" : "already unchecked" };

    const text = criterionLogText(c.text);
    return {
      body: (b) => flipCriterion(b, c, target),
      appendLog: `${now} ${actor} ${target ? "check" : "uncheck"} ac=${c.n}${text === "" ? "" : `: ${text}`}`,
    };
  });

  return { id: opts.id, n: picked.n, text: picked.text, checked: target, changed: r.wrote };
}
