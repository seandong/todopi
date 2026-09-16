// src/domain/graph.ts
// 图不变量：引用存在（4）与无环（5）。纯函数，不碰文件系统。

import type { TaskFile } from "./types.ts";
import type { Finding } from "./findings.ts";

export function validateGraph(tasks: TaskFile[]): Finding[] {
  const out: Finding[] = [];
  const byId = new Map<string, TaskFile>();
  for (const t of tasks) {
    const id = t.frontmatter["id"];
    if (typeof id === "string") byId.set(id, t);
  }

  // 不变量 4 —— 引用存在
  for (const t of tasks) {
    const parent = t.frontmatter["parent"];
    if (typeof parent === "string" && !byId.has(parent)) {
      out.push({ rule: "invariant-4", path: t.path, message: `parent 指向不存在的任务 ${parent}` });
    }
    for (const b of asIdList(t.frontmatter["blocked_by"])) {
      if (!byId.has(b)) {
        out.push({ rule: "invariant-4", path: t.path, message: `blocked_by 指向不存在的任务 ${b}` });
      }
    }
  }

  // 不变量 5 —— 两个图各自无环
  out.push(...findCycles(byId, "parent", (t) => {
    const p = t.frontmatter["parent"];
    return typeof p === "string" ? [p] : [];
  }));
  out.push(...findCycles(byId, "blocked_by", (t) => asIdList(t.frontmatter["blocked_by"])));

  return out;
}

function asIdList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * 深度优先找环。用「白/灰/黑」三色标记：灰表示在当前递归栈上，再次遇到灰节点即成环。
 * 每个环只报一次——按环上成员集合去重，否则一个 n 元环会被报 n 次，而报告的价值
 * 在于指出「有这么一个环」，不在于重复它。
 */
function findCycles(
  byId: Map<string, TaskFile>,
  label: string,
  edges: (t: TaskFile) => string[],
): Finding[] {
  const out: Finding[] = [];
  const state = new Map<string, "grey" | "black">();
  const stack: string[] = [];
  const reported = new Set<string>();

  const visit = (id: string): void => {
    const s = state.get(id);
    if (s === "black") return;
    if (s === "grey") {
      const at = stack.indexOf(id);
      const cycle = stack.slice(at).concat(id);
      const key = [...new Set(cycle)].sort().join(",");
      if (!reported.has(key)) {
        reported.add(key);
        const t = byId.get(id)!;
        out.push({ rule: "invariant-5", path: t.path, message: `${label} 图有环：${cycle.join(" → ")}` });
      }
      return;
    }
    const t = byId.get(id);
    if (!t) return;                    // 悬空引用由不变量 4 报
    state.set(id, "grey");
    stack.push(id);
    for (const next of edges(t)) visit(next);
    stack.pop();
    state.set(id, "black");
  };

  for (const id of [...byId.keys()].sort()) visit(id);
  return out;
}
