// src/domain/order.ts
// spec §7.4 的排序。纯函数。

import type { TaskFile } from "./types.ts";

function rankOf(t: TaskFile): string | null {
  const r = t.frontmatter["rank"];
  return typeof r === "string" && r !== "" ? r : null;
}

function createdOf(t: TaskFile): string {
  const c = t.frontmatter["created"];
  return typeof c === "string" ? c : "";
}

/**
 * 码点升序。**不能用 localeCompare**——它是语言环境相关的，实测 `A0` 与 `a0`
 * 的先后在它与码点比较下相反，而 spec §7.4 要求的是码点比较。
 * `<` / `>` 比较 UTF-16 码元，对 base36 的 rank 等价于码点。
 */
function byCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * spec §7.4：
 *   1. 有 rank 的在前，按 rank 码点升序；
 *   2. 然后是无 rank 的，按 created 升序；
 *   3. 并列按 id。
 *
 * created 直接按字符串比较：RFC 3339 的 UTC 秒级时间戳是固定宽度，
 * 字符串序等价于时间序（已实测）。
 *
 * 第 3 条不能省。Array.prototype.sort 自 ES2019 起稳定，但稳定性保留的是
 * **输入顺序**，而输入顺序来自 readdirSync——那不是我们能控制的东西。
 */
export function compareTasks(a: TaskFile, b: TaskFile): number {
  const ra = rankOf(a), rb = rankOf(b);
  if (ra !== null && rb !== null) {
    const c = byCodepoint(ra, rb);
    if (c !== 0) return c;
  } else if (ra !== null) {
    return -1;
  } else if (rb !== null) {
    return 1;
  } else {
    const c = byCodepoint(createdOf(a), createdOf(b));
    if (c !== 0) return c;
  }
  return byCodepoint(a.idFromFilename, b.idFromFilename);
}

/** 返回新数组，不改动入参。 */
export function sortTasks(tasks: TaskFile[]): TaskFile[] {
  return [...tasks].sort(compareTasks);
}
