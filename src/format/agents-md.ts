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
    // 没有段落：追加。与原有内容之间保证恰好一个空行，不粘连也不堆叠。
    const body = before.replace(/\n*$/, "");
    writeFileAtomic(path, `${body}\n\n${section}`);
    return "appended";
  }

  const endAt = before.indexOf(PROTOCOL_END, begin);
  if (endAt < 0) {
    throw new Error(
      `${path} 里有 todopi 协议的起始标记但没有结束标记。段落的边界无法确定，` +
        `拒绝改写以免破坏文件。手工删掉那行起始标记再重跑，或补上结束标记。`,
    );
  }

  const head = before.slice(0, begin);
  const tail = before.slice(endAt + PROTOCOL_END.length).replace(/^\n/, "");
  const next = head + section + tail;
  if (next === before) return "unchanged";
  writeFileAtomic(path, next);
  return "replaced";
}
