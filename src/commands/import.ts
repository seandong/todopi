// src/commands/import.ts
// FR-I1：`import <plan.md>`。标题变容器、条目变子任务、文档顺序变 rank、勾选了的条目建成 closed/done 且 forced=true
// （没跑过验证，看板与列表会显示为「未验证」）。每个任务的 created 记 `source=<path>`；按来源 + 身份键幂等（D040）。
//
// **重复导入不动已有的任务**：rank、状态、内容都保留（验收标准「已存在任务的 rank 保留」）——计划里后来勾上的条目
// 不会把账本里的任务关掉，那要走 done 的门禁。新出现的条目排到最后。
//
// 纯解析、不联网：只读这一个文件（ARCH-001）。整次导入在一把账本锁里：两个并发的导入各自判定「还没导入过」就会
// 建出两份。

import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { currentActor } from "./actor.ts";
import { checkTitle } from "./add.ts";
import { withLockConflictMapped } from "./claim.ts";
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { createTaskUnlocked, withLedgerLock } from "../format/write.ts";
import { parseChecklist } from "../markdown/checklist.ts";
import { importedKeys, planImport } from "../domain/import-plan.ts";
import { validateWrite } from "../domain/validate.ts";
import type { ImportReport } from "../output/dto/import.ts";
import { EXIT, CliError } from "../exit.ts";

/** Log 的参数值不能有空白（spec §5.3.3）：空白与 % 按 %XX 编码。 */
export function encodeSource(path: string): string {
  return path.replace(/[%\s]/gu, (c) => [...Buffer.from(c, "utf8")].map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join(""));
}

/** 来源：相对项目根的 POSIX 路径；在项目外就用绝对路径。 */
export function sourceFor(root: string, file: string): string {
  const rel = relative(root, file);
  const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  return encodeSource((inside ? rel : file).split(sep).join("/"));
}

export function runImport(opts: { directory: string; file: string; actor?: string }): ImportReport {
  const ledger = discoverLedger(opts.directory);
  const file = resolve(opts.file);
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (err) {
    throw new CliError(EXIT.usage, `Cannot read ${opts.file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = bytes.toString("utf8");
  if (!bytes.equals(Buffer.from(text, "utf8"))) throw new CliError(EXIT.usage, `${opts.file} is not valid UTF-8; nothing was imported.`);

  const plan = planImport(parseChecklist(text));
  const source = sourceFor(ledger.root, file);
  const actor = currentActor(ledger.root, opts.actor);
  for (const t of plan.tasks) checkTitle(t.title);

  const created: ImportReport["created"] = [];
  let existing = 0;
  withLockConflictMapped(() => withLedgerLock(ledger, () => {
    const idByKey = importedKeys(readTasks(ledger), source);
    for (const t of plan.tasks) {
      if (idByKey.has(t.key)) { existing += 1; continue; }
      const parent = t.parentKey === undefined ? undefined : idByKey.get(t.parentKey);
      const task = createTaskUnlocked(ledger, (ctx) => ({
        id: ctx.newId(),
        title: t.title,
        status: t.closed ? "closed" : "open",
        resolution: t.closed ? "done" : undefined,
        rank: ctx.nextRank(),
        created: ctx.now,
        updated: ctx.now,
        parent,
        description: t.description,
        log: [
          `${ctx.now} ${actor} created source=${source}`,
          ...(t.closed ? [`${ctx.now} ${actor} done verify=none forced=true: checked in ${source} when imported`] : []),
        ],
      }), (candidate, all) => validateWrite(candidate, all));
      idByKey.set(t.key, task.idFromFilename);
      created.push({
        id: task.idFromFilename, title: t.title, status: t.closed ? "closed" : "open",
        ...(t.closed ? { resolution: "done" } : {}), ...(parent !== undefined ? { parent } : {}),
      });
    }
  }));
  return { source, created, existing, warnings: plan.warnings };
}
