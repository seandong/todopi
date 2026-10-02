// src/output/render/layout.ts
// Cargo 式排版的共用记号（tp-rk6o8q，docs/plans/2026-09-28-cargo-style-output.md）。每个命令一份排版，Style 决定上不上色，
// 以及有没有给人看的部分（表头、小结、~，见 Style.interactive）。不用任何符号——东亚宽度里 ● ○ 是「模糊宽度」，会让列错位。
//
// 本文件 MUST NOT import src/domain/（ARCH-008）。

import type { Style } from "../style.ts";

/** 动词列的宽度：动词右对齐到这一列，空一格接对象（Cargo 用 12） */
export const VERB_WIDTH = 12;

/** 动作的语气：成功、改动、没做什么、被拒 */
export type Tone = "ok" | "change" | "noop" | "fail";

function paint(s: Style, tone: Tone, word: string): string {
  if (tone === "ok") return s.bold(s.green(word));
  if (tone === "change") return s.bold(s.yellow(word));
  if (tone === "fail") return s.bold(s.red(word));
  return s.dim(word);
}

/** `     Created .todopi/config.yml`：动词右对齐、上色，对象原样 */
export function action(s: Style, word: string, object: string, tone: Tone = "ok"): string {
  const pad = " ".repeat(Math.max(0, VERB_WIDTH - word.length));
  return object === "" ? `${pad}${paint(s, tone, word)}` : `${pad}${paint(s, tone, word)} ${object}`;
}

/** 对象接在动作行后面、自己占一行时的缩进（与动词之后的对象对齐） */
export const OBJECT_INDENT = " ".repeat(VERB_WIDTH + 1);

/** `tp-1lfw9u  Write hello.sh`：id 青色 */
export function task(s: Style, id: string, title: string): string {
  return `${s.cyan(id)}  ${title}`;
}

/** `error: …` / `warning: …` / `note: …` */
export function diagnostic(s: Style, kind: "error" | "warning" | "note", message: string): string {
  const label = kind === "error" ? s.bold(s.red("error:")) : kind === "warning" ? s.bold(s.yellow("warning:")) : s.bold("note:");
  return `${label} ${kind === "note" ? message : s.bold(message)}`;
}

/**
 * 「下一步」区块：标题 Next，每行一条命令与一句说明（命令对齐）。numbered 只在顺序有意义时给（init：先接入 agent 再建任务）。
 * 返回的行不含前面的空行，调用方决定与上文怎么隔开。
 */
export function next(s: Style, items: readonly (readonly [command: string, what: string])[], numbered = false): string[] {
  const label = (i: number, c: string) => (numbered ? `${i + 1}. ${c}` : c);
  const width = Math.max(...items.map(([c], i) => label(i, c).length));
  return [
    s.bold("Next"),
    ...items.map(([c, what], i) => {
      const shown = numbered ? `${i + 1}. ${s.cyan(c)}` : s.cyan(c);
      return `  ${shown}${" ".repeat(width - label(i, c).length)}   ${s.dim(what)}`;
    }),
  ];
}

/** 家目录缩成 ~：只在有人在看时；被管道接走、agent 在场时照旧给绝对路径 */
export function shownPath(s: Style, path: string, home: string | undefined): string {
  if (!s.interactive || home === undefined || home === "") return path;
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** 状态词的颜色（ls、show 共用）：进行中黄、过期红、可做与完成绿、被挡与其余结局暗；unverified 的完成不算绿 */
export function paintStatus(s: Style, word: string, unverified = false): string {
  if (word === "in progress") return s.yellow(word);
  if (word === "stale") return s.red(word);
  if (word === "ready" || (word === "done" && !unverified)) return s.green(word);
  if (word === "open") return word;
  return s.dim(word);
}
