// src/commands/transition.ts
// done / close / reopen 共用的骨架。spec §6.1 的三行迁移在形状上是同一件事：
// 取锁 → 读 → 判门禁 → 构造并校验 → 写任务 → 动租约。
//
// 写成一份而不是三份，是因为**那条「共享租约也要查」的边界在 F05 里被我按入口
// 一个个加、漏了三次**（DECISIONS D019）。同一个骨架意味着下次再立新边界时，
// 三条命令自动一起拿到。

import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { withLedgerLock, prepareUpdate, nowStamp } from "../format/write.ts";
import { deleteLease, readLease } from "../format/lease.ts";
import { indexTasks } from "../domain/derive.ts";
import type { TaskFile } from "../domain/types.ts";
import { evaluateGates, worstCode, type Refusal, type Transition, type VerifyOutcome } from "../domain/gates.ts";
import { validateWrite } from "../domain/validate.ts";
import { currentActor } from "./actor.ts";
import { withLockConflictMapped } from "./claim.ts";
import { EXIT, CliError } from "../exit.ts";
import { gateActions } from "../output/render/gate.ts";
import type { GateReport, TransitionReport } from "../output/dto/gate.ts";

/** 门禁拒绝时抛它：调用方据此打印 FR-D2a 的报告，而不是一句话。 */
export class GateRefused extends Error {
  readonly report: GateReport;
  readonly code: number;
  constructor(report: GateReport) {
    super(`Refused to ${report.transition} ${report.id}`);
    this.name = "GateRefused";
    this.report = report;
    this.code = report.code;
  }
}

export type TransitionOptions = {
  directory: string;
  id: string;
  transition: Transition;
  actor?: string;
  force?: boolean;
  reason?: string;
  /** close 才有 */
  resolution?: string;
};

/** 每种迁移写出的 frontmatter 变化与 Log 行，由调用方给。 */
export type TransitionShape = {
  frontmatter: (current: Record<string, unknown>) => Record<string, unknown>;
  logLine: (ctx: {
    now: string; actor: string; forced: boolean; reason?: string;
    /** 这次 verify 的结果；没跑就是 undefined（Log 里记 verify=none） */
    verify?: VerifyOutcome;
  }) => string;
  /** 迁移之后租约怎么办。done/close 删掉，reopen 也删——三者都不再有人持有 */
  dropLease: boolean;
  /**
   * 跑这个任务的 `verify` 并给出结果。只有 `done` 提供它。
   *
   * 在锁内、其余门禁都过了之后才调用——为一个注定要被未勾复选框挡下的任务跑
   * 十分钟测试，既浪费又出人意料（spec §6.1 的 done 行把 verify 写在最前，
   * 那是效果的顺序不是求值的顺序）。
   */
  runVerify?: (task: TaskFile) => VerifyOutcome | undefined;
};

export function runTransition(opts: TransitionOptions, shape: TransitionShape): TransitionReport {
  const ledger = discoverLedger(opts.directory);
  const actor = currentActor(ledger.root, opts.actor);
  const forced = opts.force === true;

  // --force 必须带 --reason：强制的价值全在那句理由上，没有理由的强制等于
  // 把一个未验证的完成悄悄塞进历史。spec §6.1 也要求把理由记进 Log。
  if (forced && (opts.reason === undefined || opts.reason.trim() === "")) {
    throw new CliError(EXIT.usage,
      "--force needs --reason <text>: the reason is what makes an overridden gate reviewable later.");
  }
  if (!forced && opts.reason !== undefined) {
    throw new CliError(EXIT.usage, "--reason only applies together with --force.");
  }

  return withLockConflictMapped(() => withLedgerLock(ledger, () => {
    const existing = readTasks(ledger);
    const task = existing.find((t) => t.idFromFilename === opts.id);
    if (task === undefined) {
      throw new CliError(EXIT.usage, `No task ${opts.id} in this ledger. Run "todopi ls" to see what is there.`);
    }

    const title = String(task.frontmatter["title"] ?? "");
    const gateBase = {
      task,
      index: indexTasks(existing),
      actor,
      transition: opts.transition,
      // **共享租约与任务文件一起查。** 租约跨 worktree 共享而任务文件不共享，
      // 本树说「是我的」完全可能是过期视图（D019）。
      lease: readLease(ledger, opts.id),
      // 时钟用毫秒；秒级截断只用于序列化。F05 在这个边界上分叉过一次（D018）。
      now: Date.now(),
      leaseHours: ledger.config.lease_hours,
    };

    const refuse = (rs: Refusal[]): never => {
      const base = {
        id: opts.id, title, transition: opts.transition, refused: rs, code: worstCode(rs),
      };
      throw new GateRefused({ ...base, actions: gateActions(base) });
    };

    // 第一轮：先判**不需要跑任何东西**的那些门禁。
    const cheap = evaluateGates(gateBase);

    // **状态门禁越不过去。** spec §6.1：`--force` 覆盖的是对「是否就绪」的判断，
    // 不是状态机本身。表格里没有 closed → closed 这一行，也没有 open → open。
    // 放行的话，一个已完成的任务能被再 done 一次、写出第二条 done 日志，
    // 随后还能被 close --force 改掉 resolution（Codex 评审实测复现）。
    const state = cheap.filter((r) => r.gate === "state");
    if (state.length > 0) refuse(state);
    // 非强制时，便宜的门禁没过就到此为止——**不去跑 verify**。
    if (!forced && cheap.length > 0) refuse(cheap);

    // 第二轮：跑 verify。**`--force` 也照跑**（PRD FR-D3）：绕过的是「门禁」那次
    // 拒绝，不是执行。不跑的话 FR-D4a 说的「证据必须留在 diff 里看得见」永远
    // 走不到——被越过的验证如果压根没跑，就没有任何证据可留。
    const verify = shape.runVerify?.(task);
    if (verify !== undefined && !forced) {
      const withVerify = evaluateGates({ ...gateBase, verify });
      if (withVerify.length > 0) refuse(withVerify);
    }

    const now = nowStamp();
    // 先构造并校验，此时还没有任何副作用（spec §6.1：被拒绝的迁移什么都不改）
    const prepared = prepareUpdate(ledger, existing, opts.id, {
      frontmatter: shape.frontmatter(task.frontmatter),
      appendLog: shape.logLine({ now, actor, forced, reason: opts.reason, verify }),
    }, validateWrite, now);

    // **先写任务文件、后删租约**，与 release 同序、与 claim 反序。理由一致：
    // 崩在中间留下的是「任务已关闭但租约还在」，那份孤儿租约会被下一次 claim
    // 按 §8 处理；反过来留下的是 committed 的记录跑到本机事实前面。
    prepared.commit();
    if (shape.dropLease) deleteLease(ledger, opts.id);

    const next = prepared.candidate.frontmatter;
    const resolution = next["resolution"];
    return {
      id: opts.id, title,
      status: String(next["status"] ?? ""),
      ...(typeof resolution === "string" ? { resolution } : {}),
      forced,
    };
  }));
}

/**
 * 拼一条 Log 行。`forced=true` 的形状必须正好能被 F04 的 `isUnverified` 解析
 * （spec §5.3.3：动词之后只能是 `key=value`，文本在 `: ` 之后）。
 *
 * 理由里的换行会破坏 §5.3.3 的单行语法——续行必须缩进两格，而那属于 F09 的
 * 多行 note。这里把换行压成空格，并说明为什么：一条被压过的理由仍然可读，
 * 而一条断掉的 Log 行会让整个文件解析不了。
 */
export function logLine(
  verb: string,
  args: Array<[string, string]>,
  ctx: { now: string; actor: string; forced: boolean; reason?: string },
): string {
  const pairs = [...args];
  if (ctx.forced) pairs.push(["forced", "true"]);
  const head = [ctx.now, ctx.actor, verb, ...pairs.map(([k, v]) => `${k}=${v}`)].join(" ");
  if (!ctx.forced || ctx.reason === undefined) return head;
  // 只把换行（含续行的缩进）压成一个空格。原来用 \s+ 会把理由里的制表符与
  // 连续空格一并折叠，那不是 §5.3.3 要求的——它只禁止 Log 行跨行。
  return `${head}: ${ctx.reason.replace(/\r?\n\s*/g, " ").trim()}`;
}
