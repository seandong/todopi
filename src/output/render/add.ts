// src/output/render/add.ts
// 本文件 MUST NOT import src/domain/（ARCH-008）。

import type { AddReport } from "../dto/add.ts";
import { PLAIN, type Style } from "../style.ts";
import { next, task } from "./layout.ts";

export function renderJson(r: AddReport): string {
  return JSON.stringify(r, null, 2);
}

/**
 * quiet 只去掉提示，不去掉结果——id 是用户跑这条命令要得到的东西。
 * 第一行以 id 打头（`tp-x  Title`），不写成动作行：agent 与脚本用 `add … | head -1 | cut -d' ' -f1` 取 id（tp-rk6o8q）。
 */
export function renderText(r: AddReport, opts: { quiet?: boolean; style?: Style } = {}): string {
  const s = opts.style ?? PLAIN;
  const lines = [task(s, r.id, r.title)];
  if (!opts.quiet) lines.push("", ...next(s, [[`todopi claim ${r.id}`, "start working on it"]]));
  return lines.join("\n") + "\n";
}
