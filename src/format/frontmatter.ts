// src/format/frontmatter.ts
import { parse as parseYaml } from "yaml";
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
      return { ok: false, error: "frontmatter 不是一个 YAML 映射" };
    }
    return { ok: true, data: data as Record<string, unknown>, path: "yaml" };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "DUPLICATE_KEY") return { ok: false, error: "frontmatter 有重复的键" };
    return { ok: false, error: `frontmatter 无法解析：${(err as Error).message.split("\n")[0]}` };
  }
}
