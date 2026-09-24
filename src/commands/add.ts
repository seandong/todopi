// src/commands/add.ts
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { createTask } from "../format/write.ts";
import { validateWrite } from "../domain/validate.ts";
import { currentActor } from "./actor.ts";
import { EXIT, CliError } from "../exit.ts";
import { LockBusyError } from "../fs/lock.ts";
import type { AddReport } from "../output/dto/add.ts";

export type AddOptions = {
  directory: string;
  title: string;
  description?: string;
  acceptance?: string[];
  labels?: string[];
  verify?: string;
  parent?: string;
  blockedBy?: string[];
  from?: string;
  actor?: string;
};

/** add 与 edit 共用的标题校验：去掉首尾空白后非空、单行、不超过 200 字符（spec §5.2）。 */
export function checkTitle(raw: string): string {
  const title = raw.trim();
  if (title === "") throw new CliError(EXIT.usage, "A task needs a title.");
  if (title.includes("\n")) throw new CliError(EXIT.usage, "A title must be a single line.");
  if (title.length > 200) {
    throw new CliError(EXIT.usage, `Title is ${title.length} characters; the limit is 200 (spec §5.2).`);
  }
  return title;
}

export function runAdd(opts: AddOptions): AddReport {
  // 校验在任何写入之前：一个被拒绝的命令不该有副作用（F02 立下的规矩）。
  const title = checkTitle(opts.title);

  const ledger = discoverLedger(opts.directory);

  // parent 与 blocked_by 必须指向存在的任务（spec §6.2 不变量 4）。在锁外检查是
  // 够的：这两个引用指向的是**已有**任务，而本产品没有删除命令（FR-T7），
  // 所以一个此刻存在的任务不会在我们拿到锁之前消失。
  const known = new Set(readTasks(ledger).map((t) => t.idFromFilename));
  const refs: Array<[string, string]> = [];
  if (opts.parent) refs.push(["parent", opts.parent]);
  for (const b of opts.blockedBy ?? []) refs.push(["blocked-by", b]);
  if (opts.from) refs.push(["from", opts.from]);
  for (const [flag, id] of refs) {
    if (!known.has(id)) {
      throw new CliError(EXIT.usage, `--${flag} references ${id}, which does not exist in this ledger.`);
    }
  }

  // FR-C4 的解析链，与 ls --mine 共用同一个入口——两处各写一遍，
  // 迟早会对同一个人得出两个身份，于是 Log 里记的和 --mine 匹配的对不上。
  const actor = currentActor(ledger.root, opts.actor);
  // fs/ 抛的是中性的 LockBusyError——它不认识 CLI 的退出码协议（ARCHITECTURE.md）。
  // 映射成 FR-Q2 的退出码 3（冲突：租约被占、并发写）是这一层的职责。
  const created = withLockConflictMapped(() => createTask(
    ledger,
    (ctx) => ({
      id: ctx.newId(),
      title,
      status: "open",
      rank: ctx.nextRank(),
      created: ctx.now,
      updated: ctx.now,
      parent: opts.parent,
      blocked_by: opts.blockedBy,
      verify: opts.verify,
      labels: opts.labels,
      description: opts.description,
      acceptance: opts.acceptance,
      log: [`${ctx.now} ${actor} created${opts.from ? ` from=${opts.from}` : ""}`],
    }),
    // 校验器与 doctor 用的是同一对函数，所以「通过校验」与「通过 doctor」是同一件事——
    // FR-T1 的验收要求的正是这个。判据是「这次写入**新引入**了什么问题」而不是
    // 「写完之后账本有没有问题」，理由见 validateWrite 的注释。
    validateWrite,
  ));

  return {
    id: created.idFromFilename,
    title,
    path: created.path,
    rank: String(created.frontmatter["rank"] ?? ""),
  };
}

/** 把 fs/ 的中性 LockBusyError 映射为 FR-Q2 的退出码 3。 */
function withLockConflictMapped<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof LockBusyError) throw new CliError(EXIT.conflict, err.message);
    throw err;
  }
}
