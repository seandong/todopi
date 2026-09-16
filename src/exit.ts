// src/exit.ts
// 退出码定义见 PRD FR-Q2。用 as const 而非 enum —— Node 的类型剥离不做
// 类型导向的代码生成，enum 会在运行时报 SyntaxError（ARCH-013）。
export const EXIT = {
  ok: 0,
  usage: 1,
  gate: 2,
  conflict: 3,
  unsupportedVersion: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** 带退出码的错误。顶层捕获后据此决定进程退出码，不在各处直接调用 process.exit。 */
export class CliError extends Error {
  readonly code: ExitCode;
  constructor(code: ExitCode, message: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}
