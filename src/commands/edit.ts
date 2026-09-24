// src/commands/edit.ts
// FR-T4：`edit <id>` 修改标题、描述、verify、标签与父任务，记 `edited fields=…`。
//
// 不做 `--edit`（$EDITOR）与正文分节编辑：前者是交互式的（F07 立过的规矩：绝不阻塞在
// TTY 上），后者不在 F10 的验收判据里。见 PRD §15。

import { writeAsWorker } from "./worker-write.ts";
import { checkTitle } from "./add.ts";
import { statusOf } from "../domain/derive.ts";
import { sectionLines } from "../domain/acceptance.ts";
import { replaceDescription } from "../domain/sections.ts";
import { structure } from "../markdown/sections.ts";
import type { EditReport } from "../output/dto/plan.ts";
import { EXIT, CliError } from "../exit.ts";

export type EditOptions = {
  directory: string; id: string; actor?: string;
  title?: string;
  description?: string;
  /** 空串表示清掉这个字段 */
  verify?: string;
  /** `+l` 加、`-l` 去、裸 `l` 加（PRD §8 的 `--label +l|-l`） */
  labels?: string[];
  /** `none` 表示清掉 */
  parent?: string;
};

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function normalizeText(t: string): string {
  const lines = t.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
  while (lines.length > 0 && lines.at(-1)!.trim() === "") lines.pop();
  return lines.join("\n");
}

export function runEdit(opts: EditOptions): EditReport {
  const given = [opts.title, opts.description, opts.verify, opts.labels, opts.parent].some((v) => v !== undefined);
  if (!given) {
    throw new CliError(EXIT.usage, "Nothing to edit. Pass --title, --description, --verify, --label or --parent.");
  }
  const title = opts.title === undefined ? undefined : checkTitle(opts.title);
  let fields: string[] = [];

  // 归属：edit 在 PRD FR-C6 的写入严格匹配名单里，走 writeAsWorker 的默认检查。
  writeAsWorker(opts, (task, { now, actor }) => {
    const fm: Record<string, unknown> = { ...task.frontmatter };
    const changed = new Set<string>();
    const set = (k: string, v: unknown): void => {
      const cur = fm[k];
      const empty = v === undefined || (Array.isArray(v) && v.length === 0);
      if (empty) {
        if (cur !== undefined) { delete fm[k]; changed.add(k); }
      } else if (JSON.stringify(cur) !== JSON.stringify(v)) {
        fm[k] = v;
        changed.add(k);
      }
    };

    if (title !== undefined) set("title", title);
    if (opts.verify !== undefined) set("verify", opts.verify.trim() === "" ? undefined : opts.verify);
    if (opts.labels !== undefined) {
      const next = strList(fm["labels"]);
      for (const raw of opts.labels) {
        const remove = raw.startsWith("-");
        const name = raw.replace(/^[+-]/, "");
        if (name === "") throw new CliError(EXIT.usage, `Label ${JSON.stringify(raw)} has no name.`);
        const at = next.indexOf(name);
        if (remove && at >= 0) next.splice(at, 1);
        if (!remove && at < 0) next.push(name);
      }
      set("labels", next);
    }
    if (opts.parent !== undefined) {
      // 已关闭任务的父任务不能改：那等于改写它当时是作为谁的子任务被接受的（同 check、dep）。
      if (statusOf(task) === "closed") {
        throw new CliError(EXIT.gate,
          `Task ${opts.id} is closed; its place in the tree is part of the record. `
          + `Reopen it first with \`todopi reopen ${opts.id}\` if it needs to move.`);
      }
      // 父任务存在与否、成不成环，由写入门禁 validateWrite 判——与 doctor 同一个查环器。
      set("parent", opts.parent === "none" ? undefined : opts.parent);
    }

    let body: ((b: string) => string) | undefined;
    if (opts.description !== undefined) {
      // 正文里有没闭合的代码围栏（或 <pre>、<!-- 这类 HTML 块）时不改写小节。读取端把那个开头当普通文字（门禁必须看得见后面的
      // 标准），可写入端若据此改写，围栏里一行 `## Description` 就会被当成真小节、连同代码一起删掉
      // （F10 第二轮评审实测）。拒绝好过猜。
      const at = structure(task.body.replace(/\r\n/g, "\n").split("\n")).unclosedAt;
      if (at >= 0) {
        throw new CliError(EXIT.usage,
          `The body of ${opts.id} has a code fence or HTML block opened at body line ${at + 1} that is never `
          + "closed, so its sections cannot be located safely. Close it first, then edit the description.");
      }
      const text = normalizeText(opts.description);
      const current = normalizeText(sectionLines(task.body, "## Description").map((l) => l.text).join("\n"));
      if (text !== current) {
        body = (b) => replaceDescription(b, text);
        changed.add("description");
      }
    }

    fields = [...changed].sort();
    // 什么都没变：不写（同 check 的理由）。
    if (fields.length === 0) return { noop: "nothing changed" };
    return { frontmatter: fm, body, appendLog: `${now} ${actor} edited fields=${fields.join(",")}` };
  });
  return { id: opts.id, fields };
}
