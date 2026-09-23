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
