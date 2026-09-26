// src/markdown/sections.ts
// Markdown 正文的结构：哪一行是标题、哪些行是代码。不认识 todopi 的格式。
//
// **判定交给 CommonMark 的参考实现，不手写近似**（DECISIONS D031）。F10 连续三轮评审都在手写的近似
// 规则里找出让 done 放行未勾标准的正文：代码块里的标题、缩进开头配错、行首 Tab。HTML 块、块引用、嵌套
// 列表……近似的洞补不完。
//
// **单独一层，读取端（domain/）与写入端（format/）都依赖它**：「找小节」曾在两边各写一份，写入端 trim、
// 读取端不 trim，事件被写进读者看不见的地方（F09，D029）。同一个判断只能有一份。ARCH-025 钉住这一层只
// 依赖 commonmark。

import { Parser } from "commonmark";
import type { Node } from "commonmark";

export type BodyStructure = {
  /** CommonMark 文档**顶层**的 ATX 二级标题所在的行号（从 0 开始）。只有它们能是小节标题 */
  h2: Set<number>;
  /** 这一行属于一个**顶层**代码块或 HTML 块——它是示例或原样文字，不是标准、不是 Log 条目 */
  code: boolean[];
  /** 第一个被当作普通文字重新解析的顶层块开头的行号；没有为 -1（见 analyse 里的偏离说明） */
  reparsedAt: number;
};

const ATX = /^##(?:[ \t]|$)/;
const OPENER = /^ {0,3}(`{3,}|~{3,})/;
const CLOSER = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * 一个顶层代码块若是围栏式的、且最后一行不是它的关闭围栏，它就是没闭合、一直延伸到了文末。
 *
 * 围栏的字符与长度从块的**首行源码**读，不读 commonmark 节点上的 `_isFenced` / `_fenceChar`——那些是
 * 下划线开头的内部字段，不在它的公开类型里，版本一变就可能没了。缩进代码块的首行至少缩进四格，匹配不上
 * OPENER，自然被排除。
 */
function isUnclosedFence(n: Node, lines: string[]): boolean {
  const [[start], [end]] = n.sourcepos;
  const open = OPENER.exec(lines[start - 1] ?? "");
  if (open === null) return false;                           // 缩进代码块
  if (end === start) return true;
  const close = CLOSER.exec(lines[end - 1] ?? "");
  return !(close !== null && close[1]![0] === open[1]![0] && close[1]!.length >= open[1]!.length);
}

/**
 * **哪些块能吞掉后面一行顶格的 `## X` 或 `- …`？** 按 CommonMark 的块逐一过（规范 §4–§5）：
 *
 * - 段落、setext 标题：ATX 标题与非空的列表项会打断段落，不可能是它的续行。
 * - 缩进代码块：至少四格缩进，顶格的行结束它。
 * - 块引用、列表项（容器）：懒续行只对段落文字成立，同上一条——顶格的 `## `、`- ` 离开容器。
 * - 链接引用定义、分隔线：单一用途的行，吞不了别的行。
 * - **围栏代码块**：到关闭围栏为止，没有就到文末。
 * - **第 1–5 类 HTML 块**（`<pre`、`<script`、`<style`、`<textarea`、`<!--`、`<?`、`<!X`、`<![CDATA[`）：
 *   到各自的结束标记为止，没有就到文末。
 * - **第 6、7 类 HTML 块**（`<div>`、任意完整标签……）：到空行为止，没有就到文末。
 *
 * 只有后三类会吞，所以偏离规则按机制写：**一个块若不是由作者写下的结束标记结束的，它就不能藏住后面
 * 的结构。** 围栏与第 1–5 类有结束标记，没写就是没闭合；第 6、7 类没有结束标记（空行不是作者对「这里
 * 结束」的声明，而是它不在），所以只要它的范围里有一行本身会开始一个标题或列表项，就当它没闭合。
 * 这个枚举由 tests/domain/markdown.test.ts 的暴力枚举验证（F10 第五轮）。
 *
 * 类别与结束标记照抄 commonmark 自己的表（reHtmlBlockOpen / reHtmlBlockClose）；它对**整行**找结束
 * 标记，包括开头那一行（`<!-->` 在 0.31 里就是一个完整的注释），这里照做——比解析器更严同样是偏离。
 */
const HTML_KINDS: [RegExp, RegExp][] = [
  [/^ {0,3}<(?:pre|script|style|textarea)(?:\s|>|$)/i, /<\/(?:pre|script|style|textarea)>/i],
  [/^ {0,3}<!--/, /-->/],
  [/^ {0,3}<\?/, /\?>/],
  [/^ {0,3}<![A-Za-z]/, />/],
  [/^ {0,3}<!\[CDATA\[/, /\]\]>/],
];

/**
 * 一行本身会开始一个标题或列表项。通用的 Markdown 知识，不认识 todopi 的小节名。
 *
 * 不含围栏：`<div>` 里吞掉的一行 ``` 自己藏不住任何东西（div 在空行处就结束了），把 div 当文字重解析
 * 反而会让那行 ``` 变成围栏开头、和后面某个无关的围栏配对，吞掉本来看得见的小节（第五轮自己的对抗用例
 * `<div>` / ``` / `</div>` 实测）。
 */
const BLOCK_START = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$))/;

function isUnclosedHtml(n: Node, lines: string[]): boolean {
  const [[start], [end]] = n.sourcepos;
  const kind = HTML_KINDS.find(([open]) => open.test(lines[start - 1] ?? ""));
  if (kind !== undefined) return !kind[1].test(lines[end - 1] ?? "");
  // 第 6、7 类：没有结束标记可写。范围里有一行会开始一个块，它就吞掉了那一行——`<div>` 紧贴着
  // `## Acceptance Criteria`，或紧贴着一条 `- [ ]`（F10 第五轮评审）。
  for (let k = start; k <= end - 1; k++) if (BLOCK_START.test(lines[k] ?? "")) return true;
  return false;
}

function analyse(lines: string[]): BodyStructure {
  const work = [...lines];
  let reparsedAt = -1;
  // 每轮至多中和一个没闭合的开头，所以轮数有上限。
  for (let round = 0; round <= lines.length; round++) {
    const doc = new Parser().parse(work.join("\n"));
    const h2 = new Set<number>();
    const code = lines.map(() => false);
    let neutralised = false;
    for (let n = doc.firstChild; n !== null; n = n.next) {
      const [[start], [end]] = n.sourcepos;
      // 只认**顶格**的 ATX（`## …`）。setext 标题（一行文字下面一行 `---`）也是二级标题，但 spec §5.3 说小节
      // 标题是 ATX 的；把它也当边界，`x` + `---` 两行就能把后面的标准切到一个无名小节里（第五轮的暴力枚举
      // 找到的）。缩进 1–3 格的 `  ## Plan` 在 CommonMark 里同样是标题，但源码行不是 `## Plan`；当成边界，
      // 它后面的标准就掉出了验收小节（第十二轮评审）。旧实现也只认顶格。
      if (n.type === "heading" && n.level === 2 && ATX.test(work[start - 1] ?? "")) h2.add(start - 1);
      if (n.type !== "code_block" && n.type !== "html_block") continue;
      // **一处刻意偏离 CommonMark。** 没有被作者写下的结束标记结束的块（见 isUnclosedHtml 上面的枚举），
      // CommonMark 让它吞掉后面的行；那样一行孤零零的 ```、<pre> 或 <div> 就能把后面的 Acceptance
      // Criteria 整段变成代码，done 的门禁于是看不见未勾的标准。这里把那个开头当普通文字重新解析，并记下
      // 位置：读取端因此总能看见后面的内容，改写正文的写入端据此拒绝。
      if ((n.type === "code_block" && isUnclosedFence(n, work)) || (n.type === "html_block" && isUnclosedHtml(n, work))) {
        if (reparsedAt < 0) reparsedAt = start - 1;
        work[start - 1] = "";
        neutralised = true;
        break;
      }
      for (let k = start - 1; k <= end - 1 && k < code.length; k++) code[k] = true;
    }
    if (!neutralised) return { h2, code, reparsedAt };
  }
  return { h2: new Set(), code: lines.map(() => false), reparsedAt };
}

/**
 * 每个命令会对同一份正文问好几次（验收标准、Log、描述……）；ls 会对每个任务问一次。解析不贵，但没有
 * 必要重复——按正文原文缓存，有上限。
 */
const cache = new Map<string, BodyStructure>();
const CACHE_LIMIT = 512;

export function structure(lines: string[]): BodyStructure {
  const key = lines.join("\n");
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const st = analyse(lines);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, st);
  return st;
}

/** 是不是一个小节标题：顶层 ATX 二级标题。源码行是否恰好等于某个名字，由调用方比。 */
export function isH2(st: BodyStructure, i: number): boolean {
  return st.h2.has(i);
}

/** 源码行恰好等于 `heading` 的第一个小节标题的行号；没有返回 -1。 */
export function headingIndex(lines: string[], st: BodyStructure, heading: string): number {
  for (let i = 0; i < lines.length; i++) if (lines[i] === heading && st.h2.has(i)) return i;
  return -1;
}

/** 从 `start`（标题行）之后开始，到下一个小节标题之前为止——返回那个结束位置（不含）。 */
export function sectionEnd(lines: string[], st: BodyStructure, start: number): number {
  let end = start + 1;
  while (end < lines.length && !st.h2.has(end)) end += 1;
  return end;
}
