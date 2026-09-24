// src/domain/sections.ts
// 改写正文里某个已识别小节的内容。纯函数。

/**
 * 把 `## Description` 的内容换成 `text`；`text` 为空就连标题一起去掉。
 *
 * **其余一个字节都不动**：spec §5.3 要求写入者原样保留未识别的内容，F09 刚在「新建 Log 小节
 * 时削掉末尾空白」上栽过。没有这一节时，新建在**第一个 H2 之前**——spec 建议 Description 排
 * 第一；首个标题之前的段落（preamble）留在原处，不被挤走。
 */
export function replaceDescription(body: string, text: string): string {
  const lines = body.split("\n");
  const block = text === "" ? [] : ["## Description", "", ...text.split("\n"), ""];
  const start = lines.indexOf("## Description");
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !lines[end]!.startsWith("## ")) end += 1;
    lines.splice(start, end - start, ...block);
    return lines.join("\n");
  }
  if (block.length === 0) return body;
  const firstHeading = lines.findIndex((l) => l.startsWith("## "));
  if (firstHeading >= 0) {
    lines.splice(firstHeading, 0, ...block);
    return lines.join("\n");
  }
  const sep = body === "" || body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
  return `${body}${sep}${block.join("\n")}\n`;
}
