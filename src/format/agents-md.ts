// src/format/agents-md.ts
import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "../fs/atomic.ts";
import { PROTOCOL_BEGIN, PROTOCOL_END, protocolSection } from "../protocol.ts";

export type UpsertResult = "created" | "appended" | "replaced" | "unchanged";

/**
 * 把协议段落写进 AGENTS.md，幂等。
 *
 * 目标文件不是我们生成的——它可能是用户精心组织的操作手册。所以段落之外的内容
 * 一个字节都不改，段落本身按标记原地替换。用「文件是否存在」判断幂等是不够的：
 * 第二次运行时文件当然存在，但里面可能还没有段落（用户先写了自己的手册）。
 */
export function upsertProtocol(path: string): UpsertResult {
  const section = protocolSection();

  if (!existsSync(path)) {
    writeFileAtomic(path, section);
    return "created";
  }

  const before = readFileSync(path, "utf8");
  const begin = before.indexOf(PROTOCOL_BEGIN);

  if (begin < 0) {
    // 没有段落：追加。原文**一个字节都不动**——只在末尾补足分隔符，使段落之前
    // 恰好有一个空行。早先的实现先用 /\n*$/ 削平所有尾部换行再补两个，那会让
    // 一个以三个以上 LF 结尾的文件被静默改写，而它属于「段落之外的内容」。
    const trailing = /\n*$/.exec(before)?.[0].length ?? 0;
    const separator = "\n".repeat(Math.max(0, 2 - trailing));
    writeFileAtomic(path, `${before}${separator}${section}`);
    return "appended";
  }

  const endAt = before.indexOf(PROTOCOL_END, begin);
  if (endAt < 0) {
    throw new Error(
      `${path} has the todopi protocol begin marker but no end marker. The section's ` +
        `boundary cannot be determined, so the file was left untouched. Remove the stray ` +
        `begin marker or add the matching end marker, then run init again.`,
    );
  }

  const head = before.slice(0, begin);
  const tail = before.slice(endAt + PROTOCOL_END.length).replace(/^\n/, "");
  const next = head + section + tail;
  if (next === before) return "unchanged";
  writeFileAtomic(path, next);
  return "replaced";
}
