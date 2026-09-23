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
  /**
   * 一条**可以直接执行**的完整命令——不含任何占位符。
   *
   * 「可直接执行」是字面意思：消费者可以原样丢给 shell。第一版把
   * `todopi close <id> --resolution <wontfix|duplicate|obsolete>` 也放在这里，
   * 那是模板不是命令，字面执行会被 shell 的 `<` 当成重定向而语法报错；
   * 而我为此写的 e2e **主动过滤掉了含 `<` 的项**，于是「每条命令都能跑」
   * 这句断言是假绿（Codex 第三轮评审）。
   *
   * 需要使用者填空的写在 `template`，两者互斥。
   */
  command?: string;
  /** 需要使用者填空的命令形状，含 `<…>` 占位符。与 `command` 互斥。 */
  template?: string;
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
