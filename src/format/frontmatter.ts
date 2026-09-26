// src/format/frontmatter.ts
import { Lexer, isMap, isNode, isScalar, parse as parseYaml, parseDocument } from "yaml";
import { scanCanonical } from "./scan.ts";

export type ParseResult =
  | { ok: true; data: Record<string, unknown>; path: "scan" | "yaml" }
  | { ok: false; error: string };

/**
 * 解析 frontmatter。规范形态走扫描器，任何偏离整个交给 yaml。
 *
 * 注意这里刻意不做类型 coerce：`rank: 007` 经 yaml 会变成数字 7，我们原样保留，
 * 由校验器报「rank 必须是字符串」。静默 coerce 成 "7" 会掩盖前导零已经丢失这个事实。
 */
export function parseFrontmatter(head: string): ParseResult {
  const scanned = scanCanonical(head);
  if (scanned !== null) return { ok: true, data: scanned, path: "scan" };

  try {
    const data = parseYaml(head) as unknown;
    if (data === null || data === undefined) return { ok: true, data: {}, path: "yaml" };
    if (typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, error: "frontmatter is not a YAML mapping" };
    }
    return { ok: true, data: data as Record<string, unknown>, path: "yaml" };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "DUPLICATE_KEY") return { ok: false, error: "frontmatter has a duplicate key" };
    return { ok: false, error: `frontmatter could not be parsed: ${(err as Error).message.split("\n")[0]}` };
  }
}

/**
 * frontmatter 里某个顶层键那一整条的源码原文：从键所在行的行首，到值结束所在行的行尾（行尾注释在内）。
 * 找不到或不是映射返回 null。
 *
 * **问 YAML 解析器，不认字符形状**：`"updated": …`、`updated : …`、`? updated` 都是同一个键，正则
 * `^updated:` 只认得第一种写法之外的一种（F13 评审三轮）。`doctor --fix` 用它原样保留 `updated`。
 */
export function entrySource(head: string, key: string): string | null {
  const doc = parseDocument(head);
  const map = doc.contents;
  if (!isMap(map)) return null;
  const pair = map.items.find((p) => isScalar(p.key) && p.key.value === key);
  if (pair === undefined || !isScalar(pair.key) || pair.key.range == null || pair.value == null
    || !isNode(pair.value) || pair.value.range == null) return null;
  const start = head.lastIndexOf("\n", pair.key.range[0] - 1) + 1;
  let end = pair.value.range[1];
  if (end > 0 && head[end - 1] === "\n") end -= 1;
  const eol = head.indexOf("\n", end);
  return head.slice(start, eol < 0 ? head.length : eol);
}

/** frontmatter 源码里的 YAML 注释（按词法器的 token，不按 `#` 字符：引号里的 `#` 不是注释）。 */
export function commentsIn(head: string): string[] {
  return [...new Lexer().lex(head)].filter((tok) => tok.startsWith("#"));
}
