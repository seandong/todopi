// src/commands/import-beads.ts
// FR-I2：`import beads [path]`，读 Beads Classic 的 issues.jsonl（默认 `.beads/issues.jsonl`）。映射见 domain/beads.ts 与 D041。
//
// 幂等：原 id 存在 `external.beads.id`，再导入时跳过已有的；新条目可以引用以前导入过的任务。整次导入在一把账本锁里，
// 而且只读一次账本——一次上千个任务，每建一个都重读会是平方级（createTaskUnlocked 的 known 参数）。
//
// 纯解析、不联网（ARCH-001）；只读这一个文件。

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { currentActor } from "./actor.ts";
import { withLockConflictMapped } from "./claim.ts";
import { sourceFor } from "./import.ts";
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { candidateFor, createTaskUnlocked, nowStamp, withLedgerLock } from "../format/write.ts";
import { nextRank, type NewTask } from "../format/emit.ts";
import { structure } from "../markdown/sections.ts";
import { planBeadsImport, type BeadsIssue } from "../domain/beads.ts";
import { sectionLines } from "../domain/acceptance.ts";
import { validateFile, validateWrite } from "../domain/validate.ts";
import type { TaskFile } from "../domain/types.ts";
import type { ImportBeadsReport } from "../output/dto/import-beads.ts";
import { EXIT, CliError } from "../exit.ts";

/** 原样放进 Description 不会改变正文的读法：没有顶层二级标题、没有没闭合的块（与 add 的判据同一份），也没有像冲突标记的行。 */
function safeText(text: string): boolean {
  // 像冲突标记的行（setext 标题的 `=======` 下划线就是）会触发不变量 7（F20 评审）
  if (/^(<<<<<<<|=======|>>>>>>>)/m.test(text)) return false;
  const st = structure(text.split("\n"));
  return st.h2.size === 0 && st.reparsedAt < 0;
}

/** 解析 JSONL：每个非空行是一个带字符串 id 与 title 的对象；有任何一行不是就整体拒绝，什么都不建。 */
export function parseIssues(text: string, name: string): BeadsIssue[] {
  const issues: BeadsIssue[] = [];
  const bad: number[] = [];
  const seen = new Set<string>();
  const dup: string[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    let v: unknown;
    try { v = JSON.parse(line); } catch { bad.push(i + 1); return; }
    if (typeof v !== "object" || v === null || Array.isArray(v)) { bad.push(i + 1); return; }
    const o = v as Record<string, unknown>;
    if (typeof o["id"] !== "string" || o["id"] === "" || typeof o["title"] !== "string") { bad.push(i + 1); return; }
    if (seen.has(o["id"])) dup.push(o["id"]);
    seen.add(o["id"]);
    issues.push(o as unknown as BeadsIssue);
  });
  if (bad.length > 0) {
    throw new CliError(EXIT.usage, `${name}: line${bad.length === 1 ? "" : "s"} ${bad.slice(0, 10).join(", ")}${bad.length > 10 ? ", ..." : ""} `
      + "is not a Beads issue (a JSON object with a string id and title); nothing was imported.");
  }
  if (dup.length > 0) {
    throw new CliError(EXIT.usage, `${name}: issue id ${dup.slice(0, 5).join(", ")} appears more than once; nothing was imported.`);
  }
  return issues;
}

function beadsIdOf(t: TaskFile): string | undefined {
  const ext = t.frontmatter["external"];
  if (typeof ext !== "object" || ext === null || Array.isArray(ext)) return undefined;
  const b = (ext as Record<string, unknown>)["beads"];
  if (typeof b !== "object" || b === null || Array.isArray(b)) return undefined;
  const id = (b as Record<string, unknown>)["id"];
  return typeof id === "string" ? id : undefined;
}

export function runImportBeads(opts: { directory: string; path?: string; actor?: string }): ImportBeadsReport {
  const ledger = discoverLedger(opts.directory);
  const file = opts.path === undefined ? join(ledger.root, ".beads", "issues.jsonl") : resolve(opts.path);
  const shown = opts.path ?? ".beads/issues.jsonl";
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (err) {
    throw new CliError(EXIT.usage, `Cannot read ${shown}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = bytes.toString("utf8");
  if (!bytes.equals(Buffer.from(text, "utf8"))) throw new CliError(EXIT.usage, `${shown} is not valid UTF-8; nothing was imported.`);
  const issues = parseIssues(text, shown);
  const source = sourceFor(ledger.root, file);
  const actor = currentActor(ledger.root, opts.actor);

  const created: ImportBeadsReport["created"] = [];
  let plan!: ReturnType<typeof planBeadsImport>;
  withLockConflictMapped(() => withLedgerLock(ledger, () => {
    const known = readTasks(ledger);
    const idOf = new Map<string, string>();
    for (const t of known) {
      const b = beadsIdOf(t);
      if (b !== undefined && !idOf.has(b)) idOf.set(b, t.idFromFilename);
    }
    plan = planBeadsImport(issues, new Set(idOf.keys()), safeText);

    // rank：priority 顺序接在账本现有的最后一个 rank 之后，与建的（拓扑）顺序无关
    let last = known.map((t) => t.frontmatter["rank"]).filter((r): r is string => typeof r === "string").sort().at(-1) ?? null;
    const rankAt: string[] = [];
    for (let n = 0; n < plan.tasks.length; n++) { last = nextRank(last); rankAt.push(last); }

    const now = nowStamp();
    const newTask = (t: typeof plan.tasks[number], id: string, resolveRef: (beadsId: string) => string | undefined): NewTask => {
      const from = t.from === undefined ? undefined : resolveRef(t.from);
      return {
        id,
        title: t.title,
        status: t.status,
        resolution: t.resolution,
        rank: rankAt[t.order]!,
        created: t.created !== undefined && t.created <= now ? t.created : now,
        updated: now,
        parent: t.parent === undefined ? undefined : resolveRef(t.parent),
        blocked_by: t.blockedBy.map((b) => resolveRef(b)!),
        labels: t.labels,
        external: { beads: { id: t.beadsId } },
        description: t.description,
        log: [
          `${now} ${actor} created source=${source}${from !== undefined ? ` from=${from}` : ""}`,
          `${now} ${actor} imported source=${source} system=beads: ${t.note.replace(/\s+/g, " ")}`,
        ],
      };
    };

    // 预检：写第一个文件之前确认每一个都写得下去（文件级的不变量、描述读回）。有一个不行就整体拒绝并点名 Beads id——
    // 中途失败会留下半个导入，而重新导入会停在同一处（F20 评审）。引用用占位 id：图关系由拓扑序保证。
    // 纵深防御：评审找出的两个触发输入（150 个 emoji 的标题、setext 的 `=======`）已在映射里修掉，现在造不出能到达这里
    // 的公开输入，所以没有专门的用例；修之前它实测拦下了 emoji 标题、一个文件都没写。
    const placeholder = `${ledger.config.id_prefix}-000000`;
    const problems: string[] = [];
    for (const t of plan.tasks) {
      const c = candidateFor(newTask(t, placeholder, () => placeholder));
      const why = typeof c === "string" ? c
        : validateFile(c).map((f) => `${f.rule}: ${f.message}`).join("; ") || readsBack(c, t.description);
      if (why) problems.push(`${t.beadsId}: ${why}`);
    }
    if (problems.length > 0) {
      throw new CliError(EXIT.usage, `${problems.length} Beads issue${problems.length === 1 ? "" : "s"} cannot be written as todopi tasks; `
        + `nothing was imported.\n${problems.slice(0, 10).map((p) => `  ${p}`).join("\n")}${problems.length > 10 ? "\n  ..." : ""}`);
    }

    for (const t of plan.tasks) {
      const task = createTaskUnlocked(ledger, (ctx) => newTask(t, ctx.newId(), (b) => idOf.get(b)),
        (candidate, all) => validateWrite(candidate, all) ?? readsBack(candidate, t.description), known);
      idOf.set(t.beadsId, task.idFromFilename);
      created.push({
        id: task.idFromFilename, beads_id: t.beadsId, title: t.title, status: t.status,
        ...(t.resolution !== undefined ? { resolution: t.resolution } : {}),
      });
    }
  }));
  return {
    source, created,
    skipped: { tombstone: plan.skipped.tombstone, ephemeral: plan.skipped.ephemeral, already_imported: plan.skipped.existing },
    dropped: {
      dangling_edges: plan.dropped.danglingEdges, other_edge_types: plan.dropped.otherEdgeTypes,
      cycle_edges: plan.dropped.cycleEdges, from_edges: plan.dropped.fromEdges, extra_parents: plan.dropped.extraParents,
      comments: plan.dropped.comments,
    },
    warnings: plan.warnings,
  };
}

/**
 * 写之前核对：描述读回来一字不差（与 add 同一个后置条件）。纵深防御：safeText 判定为安全的文字本就读得回来，
 * 这一道只在那个判定本身出错时才会拦下——造不出绕过前一道的输入，所以没有专门的用例。
 */
function readsBack(candidate: TaskFile, description: string | undefined): string | null {
  const got = sectionLines(candidate.body, "## Description").map((l) => l.text).join("\n").trim();
  return got === (description ?? "").trim() ? null : "the description would not read back unchanged";
}
