// src/output/render/claim.ts
// 渲染层只认 dto，不认领域对象（ARCH-008）。

import type { ClaimReport, ReleaseReport } from "../dto/claim.ts";

export function renderClaimJson(r: ClaimReport): string {
  return JSON.stringify(r, null, 2);
}

export function renderReleaseJson(r: ReleaseReport): string {
  return JSON.stringify(r, null, 2);
}

/**
 * 一行说清发生了什么。读它的是 agent，所以「替换了谁」必须出现在文本里——
 * 只说 "Claimed" 的话，一个刚刚被顶掉的工作者从输出里看不出自己被顶掉了。
 */
export function renderClaim(r: ClaimReport, opts: { quiet?: boolean } = {}): string {
  if (r.refreshed) {
    return opts.quiet ? "" : `Already yours: ${r.id}  ${r.title}\nLease refreshed.\n`;
  }
  const head = `Claimed ${r.id}  ${r.title}\n`;
  if (r.replaced === undefined) return head;
  return `${head}Took it over from ${r.replaced}; this is recorded in the task log.\n`;
}

export function renderRelease(r: ReleaseReport, opts: { quiet?: boolean } = {}): string {
  const head = `Released ${r.id}  ${r.title}\n`;
  return opts.quiet ? head : `${head}It is open again and anyone can claim it.\n`;
}
