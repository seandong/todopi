// src/commands/edit.ts
// FR-T4：`edit <id>` 修改标题、描述、verify、标签、父任务、验收标准与 Plan，记 `edited fields=…`。
//
// 验收标准只能改没勾的（F24）：已勾选的是记录——悄悄改掉它的文字，等于改写「当时核对的是什么」。
// `--edit`（打开 $EDITOR）在 commands/editor.ts，它解析出的也是这里的这些改动。

import { writeAsWorker } from "./worker-write.ts";
import { checkTitle } from "./add.ts";
import { statusOf } from "../domain/derive.ts";
import { sectionLines } from "../domain/acceptance.ts";
import { editCriteria, replaceDescription, replaceSection, type CriteriaEdit } from "../domain/sections.ts";
import { parseAcceptance } from "../domain/acceptance.ts";
import { structure } from "../markdown/sections.ts";
import { UNCLOSED } from "../format/write.ts";
import type { EditReport } from "../output/dto/plan.ts";
import { buildBuffer, parseBuffer } from "../domain/edit-buffer.ts";
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { EditorError, editText } from "../exec/editor.ts";
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
  /** 空串表示清掉 Plan */
  plan?: string;
  /** 按编号增、改、删没勾的验收标准 */
  criteria?: CriteriaEdit;
  /**
   * 整段换掉 Acceptance Criteria 小节的原文（`--edit` 用：编辑器里看到的是整段，包括说明文字）。已勾选的标准必须原样、
   * 按原顺序留着。与 criteria 不同时给。
   */
  acceptanceSection?: string;
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
  const hasCriteria = opts.criteria !== undefined
    && ((opts.criteria.add?.length ?? 0) + (opts.criteria.set?.size ?? 0) + (opts.criteria.remove?.size ?? 0)) > 0;
  const given = [opts.title, opts.description, opts.verify, opts.labels, opts.parent, opts.plan, opts.acceptanceSection].some((v) => v !== undefined)
    || hasCriteria;
  if (!given) {
    throw new CliError(EXIT.usage,
      "Nothing to edit. Pass --title, --description, --verify, --label, --parent, --plan, --ac-add, --ac-set, --ac-rm or --edit.");
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
    const bodyEdits = opts.description !== undefined || opts.plan !== undefined || hasCriteria || opts.acceptanceSection !== undefined;
    if (bodyEdits) {
      // 正文里有没闭合的代码围栏（或 <pre>、<!-- 这类 HTML 块）时不改写小节。读取端把那个开头当普通文字（门禁必须看得见后面的
      // 标准），可写入端若据此改写，围栏里一行 `## Description` 就会被当成真小节、连同代码一起删掉
      // （F10 第二轮评审实测）。拒绝好过猜。
      const at = structure(task.body.replace(/\r\n/g, "\n").split("\n")).reparsedAt;
      if (at >= 0) throw new CliError(EXIT.usage, `Cannot edit the body of ${opts.id}: ${UNCLOSED(at)}`);
    }
    const section = (b: string, h: string) => normalizeText(sectionLines(b, h).map((l) => l.text).join("\n"));
    const acSections = (b: string) => {
      const lines = b.split("\n");
      const st = structure(lines);
      return lines.filter((l, i) => l === "## Acceptance Criteria" && st.h2.has(i)).length;
    };
    if ((hasCriteria || opts.acceptanceSection !== undefined) && acSections(task.body) > 1) {
      throw new CliError(EXIT.usage,
        `Task ${opts.id} has more than one "## Acceptance Criteria" section, so where an edit goes is ambiguous. `
        + "Run `todopi doctor` and merge them into one first.");
    }
    if (hasCriteria && opts.acceptanceSection !== undefined) {
      throw new CliError(EXIT.usage, "Give criteria changes either as --ac-* options or through --edit, not both.");
    }

    const steps: ((b: string) => string)[] = [];
    let wantDescription: string | undefined;
    let wantPlan: string | undefined;
    if (opts.description !== undefined) {
      const text = normalizeText(opts.description);
      if (text !== section(task.body, "## Description")) {
        wantDescription = text;
        steps.push((b) => replaceDescription(b, text));
        changed.add("description");
      }
    }
    if (opts.plan !== undefined) {
      const text = normalizeText(opts.plan);
      if (text !== section(task.body, "## Plan")) {
        wantPlan = text;
        steps.push((b) => replaceSection(b, "## Plan", text));
        changed.add("plan");
      }
    }
    const before = parseAcceptance(task.body).map((c) => ({ text: c.text, checked: c.checked }));
    let wantCriteria: { text: string; checked: boolean }[] | undefined;
    if (hasCriteria) {
      const e = opts.criteria!;
      // 先在原正文上试一次：编号越界、动了勾选的，当场说清楚（写入回调里抛的会被当成内部错误）
      try {
        editCriteria(task.body, e);
      } catch (err) {
        throw new CliError(EXIT.usage, `Cannot edit the acceptance criteria of ${opts.id}: ${(err as Error).message.replace("<id>", opts.id)}.`);
      }
      // 排第一：编号是编辑之前的编号，得在描述、Plan 改动之前按原正文的行号改
      steps.unshift((b) => editCriteria(b, e));
      // 按编辑前的编号算出预期的列表：写完之后读回来必须恰好是它
      wantCriteria = before.flatMap((c, i) => (e.remove?.has(i + 1) ? [] : [{ text: e.set?.get(i + 1)?.trim() ?? c.text, checked: c.checked }]))
        .concat((e.add ?? []).map((t) => ({ text: t.trim(), checked: false })));
      changed.add("acceptance");
    }
    if (opts.acceptanceSection !== undefined) {
      const text = normalizeText(opts.acceptanceSection);
      if (text !== normalizeText(sectionLines(task.body, "## Acceptance Criteria", true).map((l) => l.text).join("\n"))) {
        steps.push((b) => replaceSection(b, "## Acceptance Criteria", text));
        changed.add("acceptance");
      }
    }

    if (steps.length > 0) {
      body = (b) => {
        const next = steps.reduce((acc, f) => f(acc), b);
        // **写完问一遍解析器**：改到的小节读回来恰好是给的内容；没改的小节（Log 一定在内）读法一个字节不变；正文里没有新出现
        // 没闭合的块。描述或 Plan 里一行顶格的 `## Acceptance Criteria` 会成为真小节、把未勾的标准挤走（F10 第八轮评审实测）。
        const read = (x: string, h: string) => sectionLines(x, h, true).map((l) => `${l.fenced}${l.text}`).join("\n");
        const untouched = ["## Description", "## Acceptance Criteria", "## Plan", "## Log"].filter((h) =>
          !(h === "## Description" && wantDescription !== undefined) && !(h === "## Plan" && wantPlan !== undefined)
          && !(h === "## Acceptance Criteria" && (hasCriteria || opts.acceptanceSection !== undefined)));
        const after = parseAcceptance(next).map((c) => ({ text: c.text, checked: c.checked }));
        const ok = untouched.every((h) => read(b, h) === read(next, h))
          && (wantDescription === undefined || section(next, "## Description") === wantDescription)
          && (wantPlan === undefined || section(next, "## Plan") === wantPlan)
          && (wantCriteria === undefined || JSON.stringify(after) === JSON.stringify(wantCriteria))
          && structure(next.split("\n")).reparsedAt < 0;
        if (!ok) {
          throw new CliError(EXIT.usage,
            "The edit would change how the rest of the task body is read: new text contains a line that starts a section "
            + "(`## …`) or a block that is never closed. Indent that line by four spaces or put it in a closed code fence, then retry.");
        }
        // 整段换掉验收标准（--edit）：已勾选的必须原样、按原顺序留着
        if (opts.acceptanceSection !== undefined) {
          const was = before.filter((c) => c.checked).map((c) => c.text);
          const now = after.filter((c) => c.checked).map((c) => c.text);
          if (JSON.stringify(was) !== JSON.stringify(now)) {
            throw new CliError(EXIT.usage,
              "Checked acceptance criteria are part of the record and cannot be changed, removed, reordered or added as checked. "
              + "Uncheck one with `todopi check <id> <n> --undo` first if it really needs to change.");
          }
        }
        return next;
      };
    }

    fields = [...changed].sort();
    // 什么都没变：不写（同 check 的理由）。
    if (fields.length === 0) return { noop: "nothing changed" };
    return { frontmatter: fm, body, appendLog: `${now} ${actor} edited fields=${fields.join(",")}` };
  });
  return { id: opts.id, fields };
}

/**
 * `edit --edit`：把标题、描述、整段验收标准、Plan 放进编辑器，保存后当作 --title / --description / 整段验收标准 / --plan
 * 交给 runEdit——校验（已勾选的不能变、其余小节读法不变）与写入都走同一条路。`edit` 是注入点，用例用假编辑器。
 * 标题行为空视为放弃，什么都不写。
 */
export function runEditInEditor(opts: EditOptions, edit: (text: string) => string = editText): EditReport {
  const ledger = discoverLedger(opts.directory);
  const task = readTasks(ledger).find((t) => t.idFromFilename === opts.id);
  if (task === undefined) throw new CliError(EXIT.usage, `No task ${opts.id} in this ledger. Run "todopi ls" to see what is there.`);
  const whole = (h: string) => normalizeText(sectionLines(task.body, h, true).map((l) => l.text).join("\n"));
  const initial = buildBuffer({
    title: String(task.frontmatter["title"] ?? ""),
    description: whole("## Description"), acceptance: whole("## Acceptance Criteria"), plan: whole("## Plan"),
  });
  const edited = parseBuffer(editOrExplain(edit, initial));
  if (edited === null) throw new CliError(EXIT.usage, "Aborted: the title line is empty. Nothing was changed.");
  return runEdit({
    ...opts, title: edited.title, description: edited.description, acceptanceSection: edited.acceptance, plan: edited.plan,
  });
}

/** 编辑器的失败（没有终端、启动不了、非零退出）变成用法错误，说清楚什么都没改。 */
export function editOrExplain(edit: (text: string) => string, initial: string): string {
  try {
    return edit(initial);
  } catch (err) {
    if (err instanceof EditorError) throw new CliError(EXIT.usage, `${err.message}.`);
    throw err;
  }
}

/** 验收标准的编号：1 起的十进制整数（`ls --limit` 的教训：`0x10`、`1.5`、`1e3` 都不是编号）。 */
export function parseCriterionNumber(raw: string, flag: string): number {
  if (!/^[1-9][0-9]*$/.test(raw.trim())) throw new CliError(EXIT.usage, `${flag} needs a criterion number (1, 2, …); got ${JSON.stringify(raw)}.`);
  return Number(raw.trim());
}
