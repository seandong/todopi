// src/output/dto/gate.ts
// 门禁报告的对外契约。--json 有版本承诺（FR-Q3）。
// 本文件只搬字段，不算任何东西（ARCH-020）——从 domain 只做类型导入。

import type { Refusal, Transition } from "../../domain/gates.ts";

export type GateReport = {
  id: string;
  title: string;
  transition: Transition;
  /** 全部未通过的门禁，不只是第一道（FR-D2a） */
  refused: Refusal[];
  /** 退出码：3（归属冲突）比 2（就绪门禁）重 */
  code: number;
  /**
   * 可以**直接执行**的下一步，按门禁给出。
   *
   * `--json` 只有拒绝的事实是不够的：FR-D2a 要求 agent 不必再跑别的命令就能
   * 据以行动，而一个解析 JSON 的 agent 拿不到人类那份文本里的命令。
   * 每一条都是能粘贴就跑的完整命令行（Codex 评审 F06）。
   */
  actions: GateAction[];
};

export type GateAction = {
  /** 这条动作是为哪道门禁给的；`retry` / `force` 是收尾的两条出路 */
  for: Refusal["gate"] | "retry" | "force";
  /** 一条完整的、可直接执行的命令；没有现成命令可给时为 undefined */
  command?: string;
  /** 一句话说明这条动作做什么 */
  detail: string;
};

/** 成功完成一次迁移之后的报告。 */
export type TransitionReport = {
  id: string;
  title: string;
  status: string;
  resolution?: string;
  /** 本次是否越过了门禁（--force） */
  forced: boolean;
};
