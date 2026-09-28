// src/output/render/show.ts
// 渲染层只认 dto（ARCH-008）。

import type { LogEntryDto, ShowDto, TreeNodeDto } from "../dto/show.ts";
import { PLAIN, type Style } from "../style.ts";
import { paintStatus } from "./layout.ts";

/** FR-T3 的 --json：单个对象。 */
export function renderShowJson(d: ShowDto): string {
  return JSON.stringify(d, null, 2);
}

/** external 是任意嵌套的映射；拍平成 `harness.legacy_id` 这样的点路径，一行一个。 */
function flatten(prefix: string, v: unknown, out: string[]): void {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    for (const [k, child] of Object.entries(v)) flatten(prefix === "" ? k : `${prefix}.${k}`, child, out);
  } else {
    out.push(`${prefix}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
}

function indent(text: string, pad: string): string {
  return text.split("\n").map((l) => (l === "" ? "" : pad + l)).join("\n");
}

function statusWord(s: { status?: string; resolution?: string }): string {
  if (s.status === "closed") return s.resolution ?? "closed";
  if (s.status === "in_progress") return "in progress";
  return s.status ?? "?";
}

function logLine(s: Style, e: LogEntryDto): string {
  if ("malformed" in e) return `${indent(e.raw, "  ")}   (malformed; see todopi doctor)`;
  const args = Object.entries(e.args).map(([k, v]) => ` ${k}=${v}`).join("");
  const [first, ...rest] = (e.text ?? "").split("\n");
  const head = `  ${s.dim(e.timestamp)} ${e.actor} ${s.bold(e.verb)}${args}${e.text === undefined ? "" : `: ${first}`}`;
  return [head, ...rest.map((l) => `      ${l}`)].join("\n");
}

function treeLine(s: Style, n: TreeNodeDto): string {
  if (n.missing === true) return `  ${s.cyan(n.id)}  (missing: no such task in this ledger)`;
  const progress = n.child_progress === undefined ? "" : ` [${n.child_progress.closed}/${n.child_progress.total}]`;
  return `  ${s.cyan(n.id)}  [${paintStatus(s, statusWord(n))}]${progress} ${n.title ?? ""}`;
}

/** 排版不变（本来就是字段表 + 节标题），style 只上色（tp-rk6o8q）：状态与 ls 同色，字段名与时间戳暗，节标题加粗。 */
export function renderShow(d: ShowDto, opts: { style?: Style } = {}): string {
  const s = opts.style ?? PLAIN;
  const out: string[] = [`${s.cyan(d.id)}  ${s.bold(d.title)}`];

  const field = (k: string, v: string | undefined): void => { if (v !== undefined && v !== "") out.push(`  ${s.dim(k.padEnd(11))}${v}`); };
  const flags: string[] = [];
  if (d.blocked) flags.push("blocked");
  if (d.stale) flags.push("stale");
  if (d.unverified) flags.push("unverified");
  if (d.ready) flags.push("ready");
  field("status", paintStatus(s, statusWord(d), d.unverified) + (flags.length > 0 ? `  [${flags.join(", ")}]` : ""));
  field("assignee", d.assignee);
  field("parent", d.parent);
  field("blocked_by", d.blocked_by.join(", "));
  if (d.child_progress !== undefined) field("children", `${d.child_progress.closed}/${d.child_progress.total} closed`);
  field("labels", d.labels.join(", "));
  field("rank", d.rank);
  field("verify", d.verify);
  field("created", d.created);
  field("updated", d.updated);
  if (d.external !== undefined) {
    const ext: string[] = [];
    flatten("", d.external, ext);
    for (const e of ext) field("external", e);
  }

  if (d.description !== undefined) out.push("", s.bold("Description"), indent(d.description, "  "));
  if (d.plan !== undefined) out.push("", s.bold("Plan"), indent(d.plan, "  "));

  const notes = d.acceptance_notes ?? [];
  if (d.acceptance.length > 0 || notes.length > 0) {
    out.push("", s.bold("Acceptance Criteria"));
    // 按原文位置交错：说明紧跟在它所属的那条标准后面，不编号、不参与门禁。
    const noteAt = (n: number): void => {
      for (const x of notes) if (x.after === n) out.push(indent(x.text, "  "));
    };
    noteAt(0);
    for (const c of d.acceptance) {
      out.push(`  ${c.n}. ${c.checked ? s.green("[x]") : s.dim("[ ]")} ${c.text}`);
      noteAt(c.n);
    }
  }

  out.push("");
  out.push(s.bold(d.log.length < d.log_total
    ? `Log (last ${d.log.length} of ${d.log_total}; --full for all)`
    : `Log (${d.log_total})`));
  for (const e of d.log) out.push(logLine(s, e));

  if (d.tree !== undefined) {
    out.push("", s.bold("Parents (root first)"));
    if (d.tree.ancestors.length === 0) out.push("  (none)");
    for (const a of d.tree.ancestors) out.push(treeLine(s, a));
    if (d.tree.cycle) out.push("  (the parent chain loops back on itself; run todopi doctor)");
    const cp = d.child_progress;
    out.push("", s.bold(cp === undefined ? "Children" : `Children (${cp.closed}/${cp.total} closed)`));
    if (d.tree.children.length === 0) out.push("  (none)");
    for (const c of d.tree.children) out.push(treeLine(s, c));
  }

  return out.join("\n") + "\n";
}
