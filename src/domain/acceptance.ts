// src/domain/acceptance.ts
// spec §5.3.2 的验收标准。纯函数：不 import node:fs，用例直接给正文字符串即可。

import { headingIndex, scanFences, sectionEnd } from "../markdown/sections.ts";

/** 正文里的一行，带它在原文中的行号，以及它是否在一个顶层代码围栏里。 */
export type BodyLine = { index: number; text: string; fenced: boolean };

/**
 * 取某个 H2 小节下的所有行（不含标题行本身），到下一个 `## ` 为止。
 *
 * 抽出来共享是因为 `logLines` 与验收标准用的是同一套查找，而 F09 的勾选写入端
 * 还要靠 `index` 定位到具体那一行去翻转方括号——重排整段会动到「MUST 被原样
 * 保留」的嵌套项与普通文字（spec §5.3.2）。
 *
 * 标题精确匹配：spec §5.3 说四个 H2 标题是「exactly and case-sensitively」认的。
 */
export function sectionLines(body: string, heading: string): BodyLine[] {
  // 行尾的 \r 要去掉。spec §5.1 要求 LF，所以 CRLF 文件本就不合规；
  // 但**静默放行比报错危险得多**——实测一份 CRLF 正文会让标题匹配失败、
  // 验收标准被解析成空集，于是 `done` 悄悄越过门禁而 doctor 还报一切正常
  // （Codex 评审复现）。这里按容错读取处理，写回时自然回到 LF。
  const lines = body.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  // 标题与小节边界都只认围栏外的 `## `（markdown/sections.ts，写入端用的是同一份）。
  const { inFence: mask, topLevel } = scanFences(lines);
  const start = headingIndex(lines, mask, heading);
  if (start < 0) return [];
  const out: BodyLine[] = [];
  for (let i = start + 1; i < sectionEnd(lines, mask, start); i++) {
    // fenced 只标**顶层**围栏：那是代码示例。列表项里的围栏是那一项的内容（比如 forced done
    // 的输出尾部），不能被当成别的东西丢掉。
    out.push({ index: i, text: lines[i]!, fenced: topLevel[i]! });
  }
  return out;
}

export type Criterion = {
  /** 文档顺序里的序号，从 1 开始。`check <id> <n>` 用的就是它 */
  n: number;
  text: string;
  checked: boolean;
  /** 在原文中的行号，F09 勾选时用它定位 */
  line: number;
};

/**
 * 顶层的 GitHub 任务项：行首就是 `- [ ] ` 或 `- [x] `，不能有缩进。
 *
 * **标记后必须是空白或行尾**（GFM 任务列表的定义）。曾把空格当可选，`- [ ]x` 于是
 * 成了一条标准——改变编号、挡住 done，而 F09 的 check 会真的去改写它（评审实测）。
 */
const ITEM_RE = /^- \[([ xX])\](?:[ \t]+(.*))?$/;

/**
 * 解析 `## Acceptance Criteria` 小节。
 *
 * spec §5.3.2 有两条容易漏的：
 *   - **嵌套列表项不是标准**（`  - [ ] child` 有缩进），因此也**不占编号**。
 *     编号错位会让 `check <id> <n>` 勾到别的行上去（F09）。
 *   - **非复选框行不是标准**，只是要被原样保留的正文。一行普通的 `- note`
 *     既不算勾上也不算没勾——把它当成未勾会让任务永远 done 不掉。
 *
 * 方括号里只认空格、`x`、`X`（写入端发 `x`）。别的字符不是 GitHub 任务项，
 * 按「非复选框行」处理。
 */
export function parseAcceptance(body: string): Criterion[] {
  const out: Criterion[] = [];
  for (const { index, text, fenced } of sectionLines(body, "## Acceptance Criteria")) {
    // 围栏里的 `- [ ] x` 是示例代码，不是标准，也不占编号。
    if (fenced) continue;
    const m = ITEM_RE.exec(text);
    if (m === null) continue;
    out.push({
      n: out.length + 1,
      text: (m[2] ?? "").trim(),
      checked: m[1] !== " ",
      line: index,
    });
  }
  return out;
}

/** spec §5.3.2：没有未勾的项就算满足；空的或没有这个小节也算满足。 */
export function allChecked(criteria: Criterion[]): boolean {
  return criteria.every((c) => c.checked);
}

/** 未勾的那些，报告要逐条列出（FR-D2a）。 */
export function unchecked(criteria: Criterion[]): Criterion[] {
  return criteria.filter((c) => !c.checked);
}

/**
 * 把第 `c.line` 行的方括号翻成 `checked`，**只动那一行的那一处**（F09 `check`）。
 *
 * spec §5.3.2：嵌套项与非复选框行 MUST 原样保留。所以不重排整段、不重新发射列表，
 * 按 `parseAcceptance` 记下的行号定位——这正是 `Criterion.line` 存在的理由。
 *
 * 行号对不上一条标准（正文在读与写之间变了，或者调用方拿错了对象）时抛错，
 * 而不是翻掉别的行：翻错一行比不翻更糟，它会让另一条标准悄悄变成已满足。
 * 写入端发小写 `x`（spec §5.3.2）；`--undo` 同样认大写 `X`。
 */
export function flipCriterion(body: string, c: Criterion, checked: boolean): string {
  const lines = body.split("\n");
  const line = lines[c.line];
  const m = line === undefined ? null : /^- \[[ xX]\]/.exec(line.endsWith("\r") ? line.slice(0, -1) : line);
  if (line === undefined || m === null) {
    throw new Error(`Line ${c.line} is not the criterion "${c.text}"; the body changed underneath.`);
  }
  lines[c.line] = `- [${checked ? "x" : " "}]${line.slice(m[0].length)}`;
  return lines.join("\n");
}

/** spec §5.3.3：`check` 记录的是「当时的标准文本、截断到 80 字符」。 */
const LOG_TEXT_MAX = 80;

/**
 * 按**码点**截断。`String.prototype.slice` 按 UTF-16 码元数，会把一个 emoji 从
 * 代理对中间切开，写进 Log 就是一个孤立的代理项。
 */
export function criterionLogText(text: string): string {
  const points = [...text];
  return points.length <= LOG_TEXT_MAX ? text : points.slice(0, LOG_TEXT_MAX).join("");
}
