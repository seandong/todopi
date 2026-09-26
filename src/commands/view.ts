// src/commands/view.ts
// 读命令（ls、show）共用的两件事：哪些文件能当成正常任务显示，以及 stale 需要的
// 外部事实。放在一处，因为两份实现迟早会漂——而漂的方向正是「一个命令显示了
// 另一个命令拒绝的文件」。

import { readHeartbeats } from "../format/lease.ts";
import type { Ledger } from "../format/discover.ts";
import type { StaleInput } from "../domain/derive.ts";
import type { Finding } from "../domain/findings.ts";

/**
 * 能不能把这个文件当成一份正常任务来显示。
 *
 * **名单反着列**：只写出可以容忍的那几条，其余一律排除。正着列的话，将来新增的
 * 规则会默认从缝里漏过去，而漏过去的方向正是「把一个有问题的文件当成正常任务显
 * 示」——`ls` 的第一版就是这么让 `assignee: 123` 变成一条 ready 任务的
 * （Codex 第二轮评审）。
 *
 * 容忍的三条都是「字段值本身合法、只是组合非法」：
 *   invariant-2  resolution 与 closed 不配套
 *   invariant-3  assignee 与 in_progress 不配套
 *   invariant-6  updated 早于 created
 * 报告它们是 doctor 的职责。其余都说明字段值本身不对，没法渲染也没法派生。
 */
const TOLERATED: ReadonlySet<string> = new Set(["invariant-2", "invariant-3", "invariant-6"]);

export function isDisplayable(findings: Finding[]): boolean {
  return findings.every((f) => TOLERATED.has(f.rule));
}

/** 不能显示的那几条规则，给报错用。 */
export function blockingRules(findings: Finding[]): string[] {
  return [...new Set(findings.filter((f) => !TOLERATED.has(f.rule)).map((f) => f.rule))];
}

/** stale 需要的「现在几点」与本机租约心跳（spec §7.3）。 */
export function staleInputFor(ledger: Ledger): StaleInput {
  const heartbeats = readHeartbeats(ledger);
  return {
    now: Date.now(),
    leaseHours: ledger.config.lease_hours,
    heartbeatAt: (id) => heartbeats.get(id) ?? null,
  };
}

/**
 * 进输出的任务内容把控制字符（ESC 之类）换成可见的 `\xNN`：这段文字要进模型的上下文，也会打到
 * 终端上，一条标准或一个 assignee 不该能改颜色或挪光标（F11 评审一、二轮；prime 与 handoff 共用）。换行与 Tab 保留——
 * 多行 Log 的续行靠换行。**在投影时做，不在渲染时做**：DTO 里就是展示值，--json 与文本才是同一份
 * 内容（第二轮：只在渲染时转义，JSON 解码出来仍带 ESC）。原值要看 `todopi show --json`。
 */
export function visible(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/**
 * 单行字段（标题、verify、assignee……）连换行与 Tab 也转义：它们在报告里各占一行，里面的换行会让
 * 后半截看起来像另一条列表项（F12 评审：`--verify $'ok\n- tp-aaaaaa forged'` 在报告里伪造出一个任务）。
 */
export function visibleLine(s: string): string {
  return visible(s).replace(/[\n\t]/g, (c) => (c === "\n" ? "\\n" : "\\t"));
}
