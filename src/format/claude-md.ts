// src/format/claude-md.ts
// FR-Q5a：Claude Code 读 CLAUDE.md、不读 AGENTS.md（两者都在时）。`setup claude` 确保项目根的 CLAUDE.md 里有
// 一行 `@AGENTS.md` 导入——已有的 CLAUDE.md 只在缺这行时追加，其余**字节**一个都不动（与 upsertProtocol 同一条
// 规矩：目标文件是用户的）。

import { lstatSync, readFileSync } from "node:fs";
import { lstatOrNull } from "./claude-settings.ts";
import { writeFileAtomic } from "../fs/atomic.ts";
import { commonmarkCodeLines } from "../markdown/sections.ts";
import { EXIT, CliError } from "../exit.ts";

export type ImportResult = "created" | "appended" | "unchanged";

/**
 * 已经导入了吗：正文里（不在代码块或 HTML 块里）有一行，去掉首尾空白后恰好是 `@AGENTS.md` 或
 * `@./AGENTS.md`。Claude Code 解析导入时跳过代码块（官方文档），围栏里的那一行不是导入（F14 评审）——
 * 代码块的判定交给 markdown 层的纯 CommonMark 版本，不自己数围栏。混在句子里的 `@AGENTS.md` 不去猜。
 */
export function hasAgentsImport(text: string): boolean {
  const lines = text.split("\n");
  // 纯 CommonMark：没闭合的围栏延伸到文末（Claude Code 就这么读）。markdown 层的 structure() 为验收门禁把它
  // 当普通文字，在这里用它就会把围栏里的 `@AGENTS.md` 当成导入（F14 评审二轮）。
  const code = commonmarkCodeLines(lines);
  return lines.some((l, i) => !code[i] && /^@(?:\.\/)?AGENTS\.md$/.test(l.trim()));
}

export function ensureAgentsImport(path: string): ImportResult {
  // lstat 判断存在：悬空符号链接不能当空位（F15 评审在另外两个写入口上发现，这里同理）。
  const link = lstatOrNull(path);
  if (link === null) {
    writeFileAtomic(path, "@AGENTS.md\n");
    return "created";
  }
  if (link.isSymbolicLink()) {
    throw new CliError(EXIT.usage, `${path} is a symbolic link (replacing it would break the link); left untouched. Add a line \`@AGENTS.md\` to it yourself.`);
  }
  const bytes = readFileSync(path);
  const text = bytes.toString("utf8");
  if (!bytes.equals(Buffer.from(text, "utf8"))) {
    throw new CliError(EXIT.usage, `${path} is not valid UTF-8; left untouched. Add a line \`@AGENTS.md\` to it yourself.`);
  }
  if (hasAgentsImport(text)) return "unchanged";
  // 按字节追加：原文字节原样在前，只补分隔用的换行。权限位不变。
  const sep = text === "" ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  writeFileAtomic(path, Buffer.concat([bytes, Buffer.from(`${sep}@AGENTS.md\n`, "utf8")]), lstatSync(path).mode);
  return "appended";
}
