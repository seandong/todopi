// src/markdown/checklist.ts
// 把一份 Markdown 计划读成「标题 + checkbox 条目」的树（FR-I1 的输入）。不认识 todopi 的格式。
//
// 判定交给 CommonMark 参考实现（D031）：代码块里的 `- [ ]` 是示例，不是条目；缩进、嵌套列表、行首 Tab 都按
// 规范算。CommonMark 本身没有任务列表扩展，`[ ]` / `[x]` 是列表项第一段开头的文字，这里照 GFM 的写法认：
// 方括号里一个空格、x 或 X，后面至少一个空白。
//
// 分隔线（`---`）结束一级标题以下的所有小节。
//
// 标题与条目的文字取**纯文本**：`**Step 1**` 的强调、`code` 的反引号、链接的目标都去掉，换行并成空格。

import { Parser } from "commonmark";
import type { Node } from "commonmark";

export type ChecklistNode =
  | { kind: "heading"; level: number; text: string; line: number; children: ChecklistNode[] }
  | { kind: "item"; checked: boolean; text: string; line: number; children: ChecklistNode[] };

const BOX = /^\[([ xX])\][ \t]+/;

/** 行内节点的纯文本。 */
function plain(n: Node): string {
  let out = "";
  const walker = n.walker();
  for (let ev = walker.next(); ev !== null; ev = walker.next()) {
    if (!ev.entering) continue;
    const t = ev.node.type;
    if (t === "text" || t === "code") out += ev.node.literal ?? "";
    else if (t === "softbreak" || t === "linebreak") out += " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

/** 列表项：第一个子块是段落、且以 `[ ]` / `[x]` 开头才是条目。 */
function asItem(li: Node): { checked: boolean; text: string } | null {
  const first = li.firstChild;
  if (first === null || first.type !== "paragraph") return null;
  const text = plain(first);
  const m = BOX.exec(text);
  if (m === null) return null;
  return { checked: m[1] !== " ", text: text.slice(m[0].length).trim() };
}

/** 一个列表：条目挂到 `into` 下；不是条目的列表项，它里面的子列表照样往 `into` 下找。 */
function collectList(list: Node, into: ChecklistNode[]): void {
  for (let li = list.firstChild; li !== null; li = li.next) {
    const item = asItem(li);
    let target = into;
    if (item !== null) {
      const node: ChecklistNode = { kind: "item", checked: item.checked, text: item.text, line: li.sourcepos[0][0], children: [] };
      into.push(node);
      target = node.children;
    }
    for (let b = li.firstChild; b !== null; b = b.next) if (b.type === "list") collectList(b, target);
  }
}

export function parseChecklist(markdown: string): ChecklistNode[] {
  const doc = new Parser().parse(markdown);
  const roots: ChecklistNode[] = [];
  // 当前所在的标题链：一个标题挂到级别比它高（数字更小）的最近标题下
  const stack: Extract<ChecklistNode, { kind: "heading" }>[] = [];
  const here = (): ChecklistNode[] => (stack.length === 0 ? roots : stack[stack.length - 1]!.children);
  for (let b = doc.firstChild; b !== null; b = b.next) {
    if (b.type === "heading") {
      while (stack.length > 0 && stack[stack.length - 1]!.level >= b.level) stack.pop();
      const h: Extract<ChecklistNode, { kind: "heading" }> = { kind: "heading", level: b.level, text: plain(b), line: b.sourcepos[0][0], children: [] };
      here().push(h);
      stack.push(h);
    } else if (b.type === "list") {
      collectList(b, here());
    } else if (b.type === "thematic_break") {
      // 分隔线结束一级标题以下的所有小节：Superpowers 的计划模板是「## Global Constraints ... --- ### Task 1」，
      // 按标题层级 Task 会挂到 Global Constraints 下面，而分隔线正是作者写下的「这一节结束了」（D040）
      while (stack.length > 0 && stack[stack.length - 1]!.level > 1) stack.pop();
    }
  }
  return roots;
}
