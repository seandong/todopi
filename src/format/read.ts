// src/format/read.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { splitEnvelope } from "./envelope.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { ID_RE, type TaskFile } from "../domain/types.ts";
import type { Ledger } from "./discover.ts";

/**
 * 读 tasks/ 下的全部任务。每次全量扫描——读路径只有一条，读到的就是磁盘真相
 * （DECISIONS D006 决策 3，由 ARCH-011 执行）。
 *
 * 解析失败的文件不被丢弃：它们带着 parseError 进结果，由校验器报告。丢弃会让
 * doctor 对一个损坏的账本报「一切正常」。
 */
export function readTasks(ledger: Ledger): TaskFile[] {
  const tasksDir = join(ledger.dir, "tasks");
  let entries: string[];
  try {
    entries = readdirSync(tasksDir);
  } catch {
    return [];
  }

  const out: TaskFile[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".md")) continue;              // spec §2：忽略其他条目
    const id = entry.slice(0, -3);
    if (!ID_RE.test(id)) continue;                     // 文件名不是合法 id，同样忽略
    const path = join("tasks", entry);
    const bytes = readFileSync(join(tasksDir, entry));
    const raw = bytes.toString("utf8");
    // spec §5.1 要求 UTF-8。解码会把非法字节静默换成 U+FFFD——记下来，doctor 才报得出，修复工具才知道
    // 不能整文件重写（F13 评审二轮）。
    const bad = !bytes.equals(Buffer.from(raw, "utf8")) ? { invalidUtf8: true } : {};

    const env = splitEnvelope(raw);
    if (env === null) {
      out.push({
        path, idFromFilename: id, frontmatter: {}, body: "", raw, ...bad,
        parseError: "not a valid envelope: the file must begin with a --- line and have a closing --- line",
      });
      continue;
    }
    const parsed = parseFrontmatter(env.head);
    if (!parsed.ok) {
      out.push({ path, idFromFilename: id, frontmatter: {}, body: env.body, raw, ...bad, parseError: parsed.error });
      continue;
    }
    out.push({ path, idFromFilename: id, frontmatter: parsed.data, body: env.body, raw, ...bad });
  }
  return out;
}
