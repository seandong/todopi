// src/domain/acceptance.ts
// spec §5.3.2 的验收标准。纯函数：不 import node:fs，用例直接给正文字符串即可。

/** 正文里的一行，带它在原文中的行号。 */
export type BodyLine = { index: number; text: string };

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
  const start = lines.findIndex((l) => l === heading);
  if (start < 0) return [];
  const out: BodyLine[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const text = lines[i]!;
    if (text.startsWith("## ")) break;
    out.push({ index: i, text });
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

/** 顶层的 GitHub 任务项：行首就是 `- [ ] ` 或 `- [x] `，不能有缩进。 */
const ITEM_RE = /^- \[([ xX])\] ?(.*)$/;

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
  for (const { index, text } of sectionLines(body, "## Acceptance Criteria")) {
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
