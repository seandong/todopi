// src/format/envelope.ts
// 信封定义见 spec §5.1：文件以 --- 行开始，YAML 映射，--- 行，然后是 Markdown 正文。

export type Envelope = { head: string; body: string };

/** 切分信封。不是合法信封时返回 null——由调用方决定这算不算错误。 */
export function splitEnvelope(text: string): Envelope | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return null;
  return { head: text.slice(4, end), body: text.slice(end + 5) };
}
