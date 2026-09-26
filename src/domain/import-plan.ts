// src/domain/import-plan.ts
// FR-I1：把一份计划的清单树（markdown/checklist.ts）映射成要建的任务，以及认出账本里同一来源已导入过的任务。
// 纯函数：不碰文件系统（ARCHITECTURE.md）。
//
// **身份键不只是（source, 标题）**（D040）：Superpowers 的计划里每个 Task 下面都有一条「Step 1: Write the failing
// test」，只按标题去重会把不同 Task 下的同名步骤认成同一个任务，第二个起就再也导不进来。键是「父级标题链 + 标题」，
// 同一个父级下完全同名的，再按出现顺序加序号。来源仍是键的一部分：只和 `created source=<同一来源>` 的任务比。

import type { ChecklistNode } from "../markdown/checklist.ts";
import type { TaskFile } from "./types.ts";
import { logLines, parseLogLine } from "./validate.ts";
import { sortTasks } from "./order.ts";

/** spec §5.2：标题最多 200 个字符。 */
const MAX_TITLE = 200;

export type PlannedTask = {
  /** 身份键：父级的键 + 标题（+ 同名序号） */
  key: string;
  parentKey?: string;
  title: string;
  /** 标题被截断时，原文放进描述 */
  description?: string;
  /** 建成 closed/done（forced）：勾选了的条目且子项全部关闭；标题容器在子项全部关闭时 */
  closed: boolean;
  /** 计划文件里的行号（报告用） */
  line: number;
};

export type ImportPlan = { tasks: PlannedTask[]; warnings: { line: number; message: string }[] };

function titleOf(text: string): { title: string; description?: string } {
  // 按字符（码点）数，不按 UTF-16 单元：一个 emoji 不该被劈成两半
  const chars = [...text];
  if (chars.length <= MAX_TITLE) return { title: text };
  return { title: `${chars.slice(0, MAX_TITLE - 1).join("")}…`, description: text };
}

/** 同一个父级下，同名的第 n 个（从 1 起）；第一个不加序号。 */
function keyed(parentKey: string | undefined, title: string, seen: Map<string, number>): string {
  const n = (seen.get(title) ?? 0) + 1;
  seen.set(title, n);
  // 结构化编码，不拼字符串：拼成 `标题#2` 会与本来就叫「A#2」的条目撞上（F19 评审）
  return JSON.stringify([parentKey ?? null, title, n]);
}

export function planImport(tree: ChecklistNode[]): ImportPlan {
  const tasks: PlannedTask[] = [];
  const warnings: ImportPlan["warnings"] = [];

  /** 一层节点：返回这一层建出来的任务是否全部关闭（没有任务时为 null）。 */
  const walk = (nodes: ChecklistNode[], parentKey: string | undefined, seen: Map<string, number>): boolean | null => {
    let all: boolean | null = null;
    for (const n of nodes) {
      const text = n.text.trim();
      if (text === "") {
        // 空文字的标题（单独一个 `##`）：它本身不成任务，下面的条目挂到上一级。条目不会走到这里——
        // markdown/checklist.ts 只把 `[ ]` 后面还有文字的认成条目
        const sub = walk(n.children, parentKey, seen);
        if (sub !== null) all = (all ?? true) && sub;
        continue;
      }
      const { title, description } = titleOf(text);
      const key = keyed(parentKey, title, seen);
      const at = tasks.length;
      // 先占位（前序：父任务在子任务之前建），子项走完再定 closed
      tasks.push({ key, parentKey, title, description, closed: false, line: n.line });
      const children = walk(n.children, key, new Map());
      if (n.kind === "heading" && children === null) {
        // 没有条目的标题（Global Constraints 之类）不成任务；同名序号也退回去
        tasks.splice(at, 1);
        seen.set(title, seen.get(title)! - 1);
        continue;
      }
      let closed: boolean;
      if (n.kind === "heading") closed = children === true;
      else {
        closed = n.checked && children !== false;
        if (n.checked && children === false) {
          warnings.push({ line: n.line, message: `"${title}" is checked but has unchecked sub-items; imported as open` });
        }
      }
      tasks[at]!.closed = closed;
      all = (all ?? true) && closed;
    }
    return all;
  };
  walk(tree, undefined, new Map());
  return { tasks, warnings };
}

/** 任务的 created 事件里的 source（spec §5.3.3）；不是导入建的返回 undefined。 */
export function importSource(t: TaskFile): string | undefined {
  for (const line of logLines(t.body)) {
    const p = parseLogLine(line);
    if (p.ok && p.verb === "created") return p.args["source"];
  }
  return undefined;
}

/**
 * 账本里从 `source` 导入过的任务，按身份键索引。键的算法与 planImport 相同：父级（同一来源的）键 + 标题 + 同名序号，
 * 同名的按 spec §7.4 的顺序（首次导入时 rank 就是文档顺序）数。
 */
export function importedKeys(tasks: TaskFile[], source: string): Map<string, string> {
  const mine = sortTasks(tasks.filter((t) => importSource(t) === source));
  const byId = new Map(mine.map((t) => [t.idFromFilename, t]));
  const keyOf = new Map<string, string>();
  const seen = new Map<string, Map<string, number>>();
  const resolve = (t: TaskFile, depth: number): string => {
    const done = keyOf.get(t.idFromFilename);
    if (done !== undefined) return done;
    const p = t.frontmatter["parent"];
    const parent = typeof p === "string" && depth < 64 ? byId.get(p) : undefined;
    const parentKey = parent === undefined ? undefined : resolve(parent, depth + 1);
    const siblings = seen.get(parentKey ?? "") ?? new Map<string, number>();
    seen.set(parentKey ?? "", siblings);
    const key = keyed(parentKey, String(t.frontmatter["title"] ?? ""), siblings);
    keyOf.set(t.idFromFilename, key);
    return key;
  };
  for (const t of mine) resolve(t, 0);
  return new Map([...keyOf].map(([id, key]) => [key, id]));
}
