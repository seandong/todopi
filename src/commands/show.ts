// src/commands/show.ts
// FR-T3：一个任务的全部细节。

import { hostname } from "node:os";
import { currentActor } from "./actor.ts";
import { blockingRules, isDisplayable, staleInputFor } from "./view.ts";
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { childProgress, deriveState, indexTasks, isContainer, type TaskIndex } from "../domain/derive.ts";
import { parseAcceptance, sectionLines } from "../domain/acceptance.ts";
import { logEntries, parseLogLine, validateFile } from "../domain/validate.ts";
import { isMine } from "../domain/actor.ts";
import { sortTasks } from "../domain/order.ts";
import type { TaskFile } from "../domain/types.ts";
import { toShowDto, type ShowDto, type TreeNode } from "../output/dto/show.ts";
import { EXIT, CliError } from "../exit.ts";

export type ShowOptions = {
  directory: string;
  id: string;
  /** 展开全部 Log，而不是最近 5 条 */
  full?: boolean;
  /** 父链与子任务进度 */
  tree?: boolean;
  actor?: string;
};

/** FR-T3：默认显示最近 5 条。 */
const RECENT = 5;

/**
 * 取某个已识别小节的正文，去掉首尾空行。没有这一节、或这一节是空的，返回 undefined。
 *
 * 只取 spec §5.3 认的那几个标题。其余小节——比如本仓库自举时生成的 `## Repair`——
 * 按 spec「MUST be ignored by readers」不显示。那是规格的边界，不是遗漏。
 */
function section(body: string, heading: string): string | undefined {
  const text = blankEdgesTrimmed(sectionLines(body, heading).map((l) => l.text)).join("\n");
  return text === "" ? undefined : text;
}

/**
 * 只剥掉首尾的**空行**，不动任何一行的内容。
 *
 * 第一版对整段 `.trim()`，会吃掉 Markdown 代码块首行的四格缩进（评审指出）——
 * 行内缩进是原文的一部分。
 */
function blankEdgesTrimmed(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a]!.trim() === "") a += 1;
  while (b > a && lines[b - 1]!.trim() === "") b -= 1;
  return lines.slice(a, b);
}

/**
 * Acceptance Criteria 小节里**不是**标准的内容，按原文位置切成块：每块记下它跟在
 * 第几条标准之后（0 = 第一条之前）。
 *
 * spec §5.3.2 说它们不是标准、MUST 原样保留——那是对写入者的约束。它们仍在一个
 * 已识别的小节里，显示出来不碰文件。本仓库自举时把判据写成了散文，不显示它们，
 * `show` 就看不见 AGENTS.md 要求 done 之前人工核对的那段话（真实账本上 dogfood
 * 才发现）。
 *
 * **位置是这里的要点。** 第一版把所有非勾选行抽出来统一放在编号项之后：第一条
 * 的说明被挪到第二条后面，人工核对时会误读归属（评审实测）。
 */
function acceptanceNotes(body: string, criterionAt: Map<number, number>): { after: number; text: string }[] {
  const out: { after: number; text: string }[] = [];
  let after = 0;
  let chunk: string[] = [];
  const flush = (): void => {
    const lines = blankEdgesTrimmed(chunk);
    if (lines.length > 0) out.push({ after, text: lines.join("\n") });
    chunk = [];
  };
  for (const l of sectionLines(body, "## Acceptance Criteria", true)) {
    const n = criterionAt.get(l.index);
    if (n === undefined) { chunk.push(l.text); continue; }
    flush();
    after = n;
  }
  flush();
  return out;
}

function treeNode(index: TaskIndex, id: string): TreeNode {
  const task = index.byId.get(id);
  if (task === undefined) return { id };
  return isContainer(index, task) ? { id, task, progress: childProgress(index, task) } : { id, task };
}

/**
 * 从直接父任务往上走到根，返回时根在前。
 *
 * **带 visited set。** parent 成环是不变量违规（doctor 报），但 show 不能因此
 * 死循环；走到见过的 id 就停下并标 cycle。parent 指向不存在的 id 时，那个节点
 * 标 missing，链到此为止——没有 frontmatter 就没有下一个 parent。
 */
function ancestorsOf(index: TaskIndex, t: TaskFile): { ancestors: TreeNode[]; cycle: boolean } {
  const chain: TreeNode[] = [];
  const seen = new Set<string>([t.idFromFilename]);
  let parent = t.frontmatter["parent"];
  while (typeof parent === "string") {
    if (seen.has(parent)) return { ancestors: chain.reverse(), cycle: true };
    seen.add(parent);
    const n = treeNode(index, parent);
    chain.push(n);
    if (n.task === undefined) break;
    parent = n.task.frontmatter["parent"];
  }
  return { ancestors: chain.reverse(), cycle: false };
}

export function runShow(opts: ShowOptions): ShowDto {
  const ledger = discoverLedger(opts.directory);
  const all = readTasks(ledger);
  const task = all.find((t) => t.idFromFilename === opts.id);
  if (task === undefined) {
    throw new CliError(EXIT.usage, `No task ${opts.id} in this ledger. Run "todopi ls" to see what is there.`);
  }
  // 与 ls 同一份容忍名单（view.ts）。不能显示就说清楚，并把人指向 doctor——
  // show 不做第二个 doctor。
  const findings = validateFile(task);
  if (!isDisplayable(findings)) {
    throw new CliError(EXIT.usage,
      `Task ${opts.id} is not a valid v1 task file (${blockingRules(findings).join(", ")}). `
      + 'Run "todopi doctor" to see what is wrong with it.');
  }

  // 图建在磁盘上**全部**任务之上，理由同 ls：一个字段坏掉的任务仍然是它父任务的
  // 子任务，排除它会让容器退化成叶子。
  const index = indexTasks(all);
  const who = { actor: currentActor(ledger.root, opts.actor), host: hostname() };

  const acceptance = parseAcceptance(task.body);
  const entries = logEntries(task.body);
  // **最近** 5 条是尾部：slice(-5)。写成 slice(0, 5) 同样「显示 5 条」，
  // 只有断言「是哪 5 条」的用例抓得到它。
  const shown = opts.full === true ? entries : entries.slice(-RECENT);

  let tree: { ancestors: TreeNode[]; children: TreeNode[]; cycle: boolean } | undefined;
  if (opts.tree === true) {
    const { ancestors, cycle } = ancestorsOf(index, task);
    const children = sortTasks(index.childrenOf.get(task.idFromFilename) ?? [])
      .map((c) => treeNode(index, c.idFromFilename));
    tree = { ancestors, children, cycle };
  }

  return toShowDto({
    task: {
      task,
      derived: deriveState(index, task, staleInputFor(ledger)),
      mine: isMine(task.frontmatter["assignee"], who),
    },
    acceptance,
    acceptanceNotes: acceptanceNotes(task.body, new Map(acceptance.map((c) => [c.line, c.n]))),
    log: shown.map((entry) => ({ entry, parsed: parseLogLine(entry.head) })),
    logTotal: entries.length,
    description: section(task.body, "## Description"),
    plan: section(task.body, "## Plan"),
    tree,
  });
}
