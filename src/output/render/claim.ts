// src/output/render/claim.ts
// 渲染层只认 dto，不认领域对象（ARCH-008）。

import type { ClaimReport, ReleaseReport } from "../dto/claim.ts";
import { PLAIN, type Style } from "../style.ts";
import { action, diagnostic, task } from "./layout.ts";

export function renderClaimJson(r: ClaimReport): string {
  return JSON.stringify(r, null, 2);
}

export function renderReleaseJson(r: ReleaseReport): string {
  return JSON.stringify(r, null, 2);
}

/**
 * 一行说清发生了什么。读它的是 agent，所以「替换了谁」必须出现在文本里——
 * 只说 "Claimed" 的话，一个刚刚被顶掉的工作者从输出里看不出自己被顶掉了。顶掉别人是结果，不是提示：--quiet 也照出。
 */
export function renderClaim(r: ClaimReport, opts: { quiet?: boolean; style?: Style } = {}): string {
  const s = opts.style ?? PLAIN;
  if (r.refreshed) {
    return opts.quiet ? "" : `${action(s, "Refreshed", `${task(s, r.id, r.title)} (already yours; lease renewed)`, "noop")}\n`;
  }
  const head = `${action(s, "Claimed", task(s, r.id, r.title))}\n`;
  if (r.replaced === undefined) return head;
  return `${head}${diagnostic(s, "warning", `took it over from ${r.replaced}; this is recorded in the task log`)}\n`;
}

export function renderRelease(r: ReleaseReport, opts: { quiet?: boolean; style?: Style } = {}): string {
  const s = opts.style ?? PLAIN;
  const head = `${action(s, "Released", task(s, r.id, r.title))}\n`;
  return opts.quiet ? head : `${head}${diagnostic(s, "note", "it is open again; anyone can claim it")}\n`;
}
