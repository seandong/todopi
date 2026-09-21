// src/domain/actor.ts
// FR-C6 的**读宽松**那一半。写入端的严格匹配在 F05/F06。

/**
 * 这个任务算不算「我的」。
 *
 * FR-C6：展示类命令（ls --mine、prime、handoff 的报告）把 assignee 等于当前
 * 解析出的 actor **或**以 `@<本机 host>` 结尾的任务都算作我的。
 *
 * 宽松的理由是具体的：actor 是 agent 级的（claude-code@mbp），而人在终端里
 * 是裸名（sean）。严格匹配会让人跑 `ls --mine` 看不到自己 agent 正在做的事——
 * 而那正是这个命令存在的意义。用 host 后缀做判据不需要任何配置，
 * 也不需要保存一份 actor 清单。
 *
 * 匹配的是 `@host` 后缀而不是子串：`claude-code@notmbp` 不是 `@mbp`。
 *
 * 空值只在一处处理。空的 assignee 提前返回之后，后面的 assignee 必然非空，
 * 于是 `opts.actor` 为空或缺失时不可能相等——不需要再给它单独加守卫。
 * 这是变异测试逼出来的：原先两处守卫各自都能挡住 `("", "")`，
 * 互为冗余，于是谁都杀不掉对方的变异体。
 */
export function isMine(assignee: unknown, opts: { actor?: string; host: string }): boolean {
  if (typeof assignee !== "string" || assignee === "") return false;
  if (assignee === opts.actor) return true;
  return assignee.endsWith(`@${opts.host}`);
}
