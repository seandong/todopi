// src/output/style.ts
// 人在终端里看时给输出上色（tp-rk6o8q）。渲染器收一个 Style，默认 PLAIN——同一份排版（render/layout.ts），PLAIN 下逐字节是纯文本。
// 上色与否只在 chooseStyle 里判定：这些输出也会进模型的上下文（钩子注入、agent 跑命令），那里一个转义字节都不能有（ARCH-027）。
// 手写 SGR，不加依赖。
//
// 本文件 MUST NOT import src/domain/（ARCH-008）。

export type Style = {
  bold: (s: string) => string;
  dim: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  cyan: (s: string) => string;
  red: (s: string) => string;
  /**
   * 有人在终端里看（与上不上色分开）：表头、小结、~ 缩写只给人看。被管道接走、agent 在场时是 false——
   * `ls | head -1`、`ls | wc -l` 这类用法拿到的只有数据行（照 gh 的做法：非终端时去掉表头）。
   */
  interactive: boolean;
};

const same = (s: string) => s;

export const PLAIN: Style = { bold: same, dim: same, green: same, yellow: same, cyan: same, red: same, interactive: false };

/** 人在看，但不要颜色（NO_COLOR、TERM=dumb）：排版同 ANSI，没有转义 */
export const MONO: Style = { ...PLAIN, interactive: true };

// 每段只复位自己开的那一项（22 关粗体与暗淡、39 恢复前景色），嵌套时不会把外层的样式也关掉
const sgr = (open: number, close: number) => (s: string) => (s === "" ? "" : `\x1b[${open}m${s}\x1b[${close}m`);

export const ANSI: Style = {
  bold: sgr(1, 22),
  dim: sgr(2, 22),
  green: sgr(32, 39),
  yellow: sgr(33, 39),
  cyan: sgr(36, 39),
  red: sgr(31, 39),
  interactive: true,
};

export type StyleFacts = {
  /** --json：输出是给程序读的 */
  json: boolean;
  /** 钩子路径（--hook、--hook-json、--if-compacted、--mark-compacted）：输出进 agent 的上下文或它要的 JSON */
  hook: boolean;
  /** 有 agent 在场：--agent / TODOPI_AGENT 给了，或环境里有任何一个 agent 的信号 */
  agent: boolean;
  env: Record<string, string | undefined>;
  isTTY: boolean;
};

/**
 * 前三条是硬性的，FORCE_COLOR 也越不过；NO_COLOR / TERM=dumb 只去掉颜色（终端里的人仍看到表头，MONO）；
 * FORCE_COLOR 只越过「stdout 不是终端」这一条。
 * 有 agent 在场就不上色，不管 isTTY：有的 agent 在伪终端里跑命令，转义会原样进它的上下文。
 */
export function chooseStyle(f: StyleFacts): Style {
  if (f.json || f.hook || f.agent) return PLAIN;
  if (f.env["NO_COLOR"] !== undefined || f.env["TERM"] === "dumb") return f.isTTY ? MONO : PLAIN;
  const force = f.env["FORCE_COLOR"];
  if (force !== undefined && force !== "" && force !== "0") return ANSI;
  return f.isTTY ? ANSI : PLAIN;
}
