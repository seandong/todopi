// src/output/render/gate.ts
// 渲染层只认 dto，不认领域对象（ARCH-008）。

import type { GateAction, GateReport, TransitionReport } from "../dto/gate.ts";

export function renderGateJson(r: GateReport): string {
  return JSON.stringify(r, null, 2);
}

export function renderTransitionJson(r: TransitionReport): string {
  return JSON.stringify(r, null, 2);
}

/**
 * 重跑这条迁移的命令。
 *
 * 命令由这里按迁移拼，不由各处手写——第一版栽过两次：写 `todopi close <id> again`
 * （缺必填的 --resolution，粘过去退出 1）、写 `todopi claim --steal`（缺 id）。
 * FR-D2a 要求「不需要再跑别的命令就能据以行动」，而一条跑不通的命令连
 * 「据以行动」的门都没进。
 *`close` 必须由使用者选一个 resolution，所以它只能给
 * **模板**——我们替他挑一个是越权。其余两条是完整可执行的命令。
 */
function retryAction(r: Omit<GateReport, "actions">): { command?: string; template?: string } {
  return r.transition === "close"
    ? { template: `todopi close ${r.id} --resolution <wontfix|duplicate|obsolete>` }
    : { command: `todopi ${r.transition} ${r.id}` };
}

/** 强制永远是模板：`--reason` 的内容只有使用者写得出来。 */
function forceTemplate(r: Omit<GateReport, "actions">): string {
  const retry = retryAction(r);
  return `${retry.command ?? retry.template ?? ""} --force --reason "<why>"`;
}

/** `--force` 越不过状态门禁（spec §6.1），所以撞上它时不该建议强制。 */
function forceable(r: Omit<GateReport, "actions">): boolean {
  return r.transition !== "reopen" && !r.refused.some((x) => x.gate === "state");
}

/**
 * 从拒绝生成**可直接执行**的动作。文本报告与 `--json` **都只从这里取**。
 *
 * 第一版只把它注入了 JSON，文本那边仍在手写另一套命令——而我在 D022 里把
 * 「两边共用」写成了已完成的事实（Codex 第二轮评审指出）。现在文本渲染遍历
 * `r.actions`，两边不可能分叉。
 */
export function gateActions(r: Omit<GateReport, "actions">): GateAction[] {
  const out: GateAction[] = [];
  for (const refusal of r.refused) {
    switch (refusal.gate) {
      case "ownership":
        // **按迁移区分。** `claim --steal` 只对未关闭的任务有意义——而 reopen
        // 的对象按定义是 closed，`claim` 会直接拒绝它（退出 2）。给一条注定
        // 失败的命令比不给更糟：agent 会照着跑，然后卡在那里（Codex 第二轮评审）。
        out.push(r.transition === "reopen"
          ? {
            for: "ownership",
            detail: `No command available. Held by ${refusal.holder}, most likely in another worktree. ` +
              "Wait for them to release it or for the lease to expire, then reopen. " +
              "Taking it over is not possible here: the task is closed, and claim refuses closed tasks.",
          }
          : {
            for: "ownership", command: `todopi claim ${r.id} --steal`,
            detail: `Held by ${refusal.holder}. Taking it over is recorded in the log.`,
          });
        break;
      case "acceptance":
        // `todopi check` 要到 F09 才有；在它落地前能真正做到这件事的是改文件。
        out.push({ for: "acceptance",
          detail: "Change `- [ ]` to `- [x]` for criteria " +
            `${refusal.unchecked.map((c) => c.n).join(", ")} in .todopi/tasks/${r.id}.md.` });
        // 同时还有子任务没关时，这条命令仍会被 children 门禁挡住——
        // 不把这一点说出来，agent 会以为它是条能立刻见效的出路（Codex 第三轮评审）。
        out.push({ for: "acceptance", command: `todopi close ${r.id} --resolution wontfix`,
          detail: r.refused.some((x) => x.gate === "children")
            ? "If the work is being abandoned rather than finished. close does not need criteria ticked, " +
              "but it still needs every child closed first — see below."
            : "If the work is being abandoned rather than finished; close does not need them ticked." });
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
            : "Already closed. Reopen it first if you need to change it. " +
              "--force does not override the state machine." });
        break;
    }
  }
  out.push({ for: "retry", ...retryAction(r),
    detail: "Run this again once the items above are fixed." });
  if (forceable(r)) {
    out.push({ for: "force", template: forceTemplate(r),
      detail: "Override every readiness gate. The task is then recorded as unverified." });
  }
  return out;
}

/** 门禁的标题行：是哪道门，以及它具体挡住了什么。动作不在这里，在 `r.actions`。 */
function headline(refusal: GateReport["refused"][number]): string[] {
  switch (refusal.gate) {
    case "ownership": {
      const since = refusal.heldSince === "" ? "" : ` Their last write was ${refusal.heldSince}.`;
      return [`Ownership: this task is held by ${refusal.holder}.${since}`];
    }
    case "acceptance":
      return [
        `Acceptance criteria: ${refusal.unchecked.length} still unchecked.`,
        ...refusal.unchecked.map((c) => `  ${c.n}. ${c.text}`),
      ];
    case "children":
      return [
        `Child tasks: ${refusal.open.length} not closed yet.`,
        ...refusal.open.map((c) => `  ${c.id}  [${c.status}]  ${c.title}`),
      ];
    case "state":
      return [`State: this task is ${refusal.status || "in an unknown state"}, ` +
        `which cannot ${refusal.transition}.`];
  }
}

/**
 * FR-D2a 的报告。它必须**不需要再跑别的命令**就能据以行动——因为这是 agent
 * 唯一能看到的东西，而协议要求它去修活而不是强制通过。
 *
 * 三个问题各自答全：哪道门禁、具体是什么、下一步做什么。
 * 全部未通过的门禁一起列出，不是只列第一道：让 agent 一次把活修完。
 *
 * **动作全部来自 `r.actions`，一条都不在这里手写**——那是文本与 `--json`
 * 不分叉的唯一保证。
 */
export function renderGateReport(r: GateReport): string {
  const out: string[] = [`Refused to ${r.transition} ${r.id}  ${r.title}`, ""];

  for (const refusal of r.refused) {
    out.push(...headline(refusal));
    for (const a of r.actions) {
      if (a.for !== refusal.gate) continue;
      const line = a.command ?? a.template;
      if (line === undefined) {
        out.push(`  ${a.detail}`);
      } else {
        out.push(`  ${line}`);
        out.push(`    ${a.detail}`);
      }
    }
    out.push("");
  }

  const retry = r.actions.find((a) => a.for === "retry");
  const force = r.actions.find((a) => a.for === "force");
  out.push(force === undefined ? "What you can do:" : "Two ways forward:");
  if (retry !== undefined) {
    out.push(`  1. ${retry.detail}`);
    const line = retry.command ?? retry.template;
    if (line !== undefined) out.push(`     ${line}`);
  }
  if (force !== undefined) {
    out.push(`  2. ${force.detail}`);
    const line = force.command ?? force.template;
    if (line !== undefined) out.push(`     ${line}`);
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
