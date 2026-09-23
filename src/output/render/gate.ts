// src/output/render/gate.ts
// 渲染层只认 dto，不认领域对象（ARCH-008）。

import type { GateReport, TransitionReport } from "../dto/gate.ts";

export function renderGateJson(r: GateReport): string {
  return JSON.stringify(r, null, 2);
}

export function renderTransitionJson(r: TransitionReport): string {
  return JSON.stringify(r, null, 2);
}

/**
 * FR-D2a 的报告。它必须**不需要再跑别的命令**就能据以行动——因为这是 agent
 * 唯一能看到的东西，而协议要求它去修活而不是强制通过。
 *
 * 三个问题必须各自答全：
 *   1. 是哪道门禁拒绝的；
 *   2. 具体是什么（未勾的标准逐条带序号与原文；未关闭的子任务带 id/标题/状态；
 *      归属冲突带持有者与其最近一次写入时间）；
 *   3. 下一步做什么——两条出路，修完重跑或强制。
 *
 * 全部未通过的门禁一起列出，不是只列第一道：让 agent 一次把活修完。
 */
export function renderGateReport(r: GateReport): string {
  const out: string[] = [`Refused to ${r.transition} ${r.id}  ${r.title}`, ""];

  for (const refusal of r.refused) {
    switch (refusal.gate) {
      case "ownership":
        out.push(`Ownership: this task is held by ${refusal.holder}.`);
        if (refusal.heldSince !== "") out.push(`  Their last write was ${refusal.heldSince}.`);
        out.push("  Ask them, or take it over with `todopi claim --steal` (that is recorded).");
        break;
      case "acceptance":
        out.push(`Acceptance criteria: ${refusal.unchecked.length} still unchecked.`);
        for (const c of refusal.unchecked) out.push(`  ${c.n}. ${c.text}`);
        out.push("  Tick them off with `todopi check <id> <n>` as you finish each one.");
        break;
      case "children":
        out.push(`Child tasks: ${refusal.open.length} not closed yet.`);
        for (const c of refusal.open) out.push(`  ${c.id}  [${c.status}]  ${c.title}`);
        out.push("  Close each child first; a parent closes when its children do.");
        break;
      case "state":
        out.push(`State: this task is ${refusal.status || "in an unknown state"}, ` +
          `which cannot ${refusal.transition}.`);
        break;
    }
    out.push("");
  }

  // 两条出路。FR-D2a 要求报告以它们结尾——agent 读到这里就知道下一步做什么，
  // 不必再跑一条命令去问。
  out.push("Two ways forward:");
  out.push(`  1. Fix what is listed above, then run \`todopi ${r.transition} ${r.id}\` again.`);
  out.push(`  2. Override with \`todopi ${r.transition} ${r.id} --force --reason "<why>"\`. ` +
    "The task is then recorded as unverified and shows up that way in every listing.");
  return out.join("\n") + "\n";
}

/** 迁移成功之后的一行确认。 */
export function renderTransition(r: TransitionReport, opts: { quiet?: boolean } = {}): string {
  const what = r.resolution === undefined ? r.status : `${r.status} (${r.resolution})`;
  const head = `${r.id}  ${r.title}  ->  ${what}\n`;
  if (opts.quiet || !r.forced) return head;
  return head + "Recorded as unverified: a gate was overridden. It shows up that way in every listing.\n";
}
