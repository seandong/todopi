// src/output/render/gate.ts
// 渲染层只认 dto，不认领域对象（ARCH-008）。

import type { GateAction, GateReport, TransitionReport } from "../dto/gate.ts";

export function renderGateJson(r: GateReport): string {
  return JSON.stringify(r, null, 2);
}

/**
 * 从拒绝生成**可直接执行**的动作。文本报告与 `--json` 共用它，
 * 所以两边给出的命令永远是同一批——分头写的话，迟早只有一边被修。
 */
export function gateActions(r: Omit<GateReport, "actions">): GateAction[] {
  const out: GateAction[] = [];
  for (const refusal of r.refused) {
    switch (refusal.gate) {
      case "ownership":
        out.push({ for: "ownership", command: `todopi claim ${r.id} --steal`,
          detail: `Held by ${refusal.holder}. Taking it over is recorded in the log.` });
        break;
      case "acceptance":
        // `todopi check` 要到 F09 才有；在它落地前能真正做到这件事的是改文件。
        out.push({ for: "acceptance",
          detail: `Change \`- [ ]\` to \`- [x]\` for criteria ` +
            `${refusal.unchecked.map((c) => c.n).join(", ")} in .todopi/tasks/${r.id}.md.` });
        out.push({ for: "acceptance", command: `todopi close ${r.id} --resolution wontfix`,
          detail: "If the work is being abandoned rather than finished; close does not need them ticked." });
        break;
      case "children":
        for (const c of refusal.open) {
          out.push({ for: "children", command: `todopi done ${c.id}`,
            detail: `Child ${c.id} is ${c.status}; a parent closes when its children do.` });
        }
        break;
      case "state":
        out.push({ for: "state",
          ...(refusal.transition === "reopen" ? {} : { command: `todopi reopen ${r.id}` }),
          detail: refusal.transition === "reopen"
            ? `Only a closed task can be reopened; this one is ${refusal.status}.`
            : "Already closed. Reopen it first if you need to change it. --force does not override the state machine." });
        break;
    }
  }
  out.push({ for: "retry", command: retryCommand(r),
    detail: "Run this again once the items above are fixed." });
  if (forceable(r)) {
    out.push({ for: "force", command: forceCommand(r),
      detail: "Override every readiness gate. The task is then recorded as unverified." });
  }
  return out;
}

export function renderTransitionJson(r: TransitionReport): string {
  return JSON.stringify(r, null, 2);
}

/**
 * 把一条迁移拼成**可以直接粘贴执行**的命令。
 *
 * 第一版在这里栽了：报告写 `todopi close <id> again`，而 close 必须带
 * `--resolution`，粘过去就退出 1；写 `todopi claim --steal` 而不带 id；
 * 还给 `reopen` 建议它根本不接受的 `--force`。FR-D2a 要求的是「不需要再跑别的
 * 命令就能据以行动」，而一条跑不通的命令连「据以行动」的门都没进（Codex 评审）。
 *
 * 所以命令由这个函数按迁移拼，不由各处手写。
 */
function retryCommand(r: Omit<GateReport, "actions">): string {
  return r.transition === "close"
    ? `todopi close ${r.id} --resolution <wontfix|duplicate|obsolete>`
    : `todopi ${r.transition} ${r.id}`;
}

function forceCommand(r: Omit<GateReport, "actions">): string {
  return `${retryCommand(r)} --force --reason "<why>"`;
}

/** `--force` 越不过状态门禁（spec §6.1），所以撞上它时不该建议强制。 */
function forceable(r: Omit<GateReport, "actions">): boolean {
  return r.transition !== "reopen" && !r.refused.some((x) => x.gate === "state");
}

/**
 * FR-D2a 的报告。它必须**不需要再跑别的命令**就能据以行动——因为这是 agent
 * 唯一能看到的东西，而协议要求它去修活而不是强制通过。
 *
 * 三个问题必须各自答全：
 *   1. 是哪道门禁拒绝的；
 *   2. 具体是什么（未勾的标准逐条带序号与原文；未关闭的子任务带 id/标题/状态；
 *      归属冲突带持有者与其最近一次写入时间）；
 *   3. 下一步做什么——每道门各带自己的动作，结尾给出路。
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
        out.push(`  Ask them, or take it over with \`todopi claim ${r.id} --steal\` (that is recorded).`);
        break;
      case "acceptance":
        out.push(`Acceptance criteria: ${refusal.unchecked.length} still unchecked.`);
        for (const c of refusal.unchecked) out.push(`  ${c.n}. ${c.text}`);
        // `todopi check` 要到 F09 才有。在它落地之前，能真正做到这件事的动作是
        // 编辑任务文件本身——报告给的每一条都必须是现在就能执行的。
        out.push(`  Tick each one off in .todopi/tasks/${r.id}.md by changing \`- [ ]\` to \`- [x]\`.`);
        out.push("  If the work is being abandoned rather than finished, " +
          `use \`todopi close ${r.id} --resolution wontfix\` instead — that does not need them ticked.`);
        break;
      case "children":
        out.push(`Child tasks: ${refusal.open.length} not closed yet.`);
        for (const c of refusal.open) out.push(`  ${c.id}  [${c.status}]  ${c.title}`);
        out.push("  Close each one first; a parent closes when its children do:");
        for (const c of refusal.open) out.push(`    todopi done ${c.id}`);
        break;
      case "state":
        out.push(`State: this task is ${refusal.status || "in an unknown state"}, ` +
          `which cannot ${refusal.transition}.`);
        if (refusal.transition === "reopen") {
          out.push("  Only a closed task can be reopened.");
        } else {
          out.push(`  It is already closed. \`todopi reopen ${r.id}\` first if you need to change it.`);
          // 状态门禁越不过去，所以这里明说，免得 agent 去试 --force。
          // reopen 那一侧不提它——那条命令根本没有这个选项，提了反而是新的误导。
          out.push("  This is the state machine, not a readiness gate: --force does not override it.");
        }
        break;
    }
    out.push("");
  }

  out.push(forceable(r) ? "Two ways forward:" : "What you can do:");
  out.push(`  1. Fix what is listed above, then run \`${retryCommand(r)}\` again.`);
  if (forceable(r)) {
    out.push(`  2. Override with \`${forceCommand(r)}\`. ` +
      "The task is then recorded as unverified and shows up that way in every listing.");
  }
  return out.join("\n") + "\n";
}

/** 迁移成功之后的一行确认。 */
export function renderTransition(r: TransitionReport, opts: { quiet?: boolean } = {}): string {
  const what = r.resolution === undefined ? r.status : `${r.status} (${r.resolution})`;
  const head = `${r.id}  ${r.title}  ->  ${what}\n`;
  if (opts.quiet || !r.forced) return head;
  return head + "Recorded as unverified: a gate was overridden. It shows up that way in every listing.\n";
}
