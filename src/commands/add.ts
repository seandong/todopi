// src/commands/add.ts
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { createTask } from "../format/write.ts";
import { EXIT, CliError } from "../exit.ts";
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

export function runAdd(opts: AddOptions): AddReport {
  const title = opts.title.trim();
  // 校验在任何写入之前：一个被拒绝的命令不该有副作用（F02 立下的规矩）。
  if (title === "") throw new CliError(EXIT.usage, "A task needs a title.");
  if (title.length > 200) {
    throw new CliError(EXIT.usage, `Title is ${title.length} characters; the limit is 200 (spec §5.2).`);
  }

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

  // actor 的完整解析链（--as > TODOPI_ACTOR > agent 环境推断 > git config user.name，
  // 含 spec §5.4 的规范化）是 F05 claim 的内容。这里只接受调用方给的值——
  // 实现半套会在 F05 里变成需要拆掉的重复实现。
  const actor = opts.actor ?? "unknown";
  const created = createTask(ledger, (ctx) => ({
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
  }));

  return {
    id: created.idFromFilename,
    title,
    path: created.path,
    rank: String(created.frontmatter["rank"] ?? ""),
  };
}
