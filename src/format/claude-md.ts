// src/format/claude-md.ts
// FR-Q5a：Claude Code 读 CLAUDE.md、不读 AGENTS.md。`setup claude` 确保项目根的 CLAUDE.md 里有一行
// `@AGENTS.md` 导入——已有的 CLAUDE.md 只在缺这行时追加，其余一个字节都不动（与 upsertProtocol 同一条规矩：
// 目标文件是用户的）。

import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "../fs/atomic.ts";

export type ImportResult = "created" | "appended" | "unchanged";

/**
 * 已经导入了吗：有一行（去掉首尾空白后）恰好是 `@AGENTS.md` 或 `@./AGENTS.md`。只认独占一行的写法——
 * 那是 Claude Code 文档里的写法，也是我们自己会写的；混在句子里的 `@AGENTS.md` 不去猜它算不算。
 */
export function hasAgentsImport(text: string): boolean {
  return text.split("\n").some((l) => /^@(?:\.\/)?AGENTS\.md$/.test(l.trim()));
}

export function ensureAgentsImport(path: string): ImportResult {
  if (!existsSync(path)) {
    writeFileAtomic(path, "@AGENTS.md\n");
    return "created";
  }
  const before = readFileSync(path, "utf8");
  if (hasAgentsImport(before)) return "unchanged";
  // 原文一个字节都不动，只在末尾补分隔：原文以换行结尾就再空一行，不以换行结尾就补两个。
  const sep = before === "" ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  writeFileAtomic(path, `${before}${sep}@AGENTS.md\n`);
  return "appended";
}
