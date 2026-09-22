// src/domain/validate.ts
// 单文件不变量。纯函数：不 import node:fs，用例直接构造对象即可（src/ARCHITECTURE.md）。

import {
  ACTOR_RE, ID_RE, LABEL_RE, RANK_RE, RESOLUTIONS, STATUSES, TIMESTAMP_RE,
  type TaskFile,
} from "./types.ts";
import type { Finding } from "./findings.ts";

const CONFLICT_RE = /^(<<<<<<<|=======|>>>>>>>)/m;

export function validateFile(t: TaskFile): Finding[] {
  const out: Finding[] = [];
  const at = (rule: Finding["rule"], message: string) => out.push({ rule, path: t.path, message });
  const fm = t.frontmatter;

  // 不变量 7 —— 冲突标记。先查，因为它会让其他所有检查的结果变得没有意义。
  if (CONFLICT_RE.test(t.raw) || CONFLICT_RE.test(t.body)) {
    at("invariant-7", "file contains unresolved git conflict markers (<<<<<<< / ======= / >>>>>>> at line start)");
  }

  // 不变量 1 —— 解析成功且 id 与文件名一致
  if (t.parseError) {
    at("envelope", t.parseError);
    return out;                       // 解析都没成功，后面的检查无从谈起
  }
  const id = fm["id"];
  if (typeof id !== "string") {
    at("invariant-1", "missing the required field \"id\", or it is not a string");
  } else {
    if (!ID_RE.test(id)) at("field", `id ${JSON.stringify(id)} does not match the spec §4 form <prefix>-<six base36 chars>`);
    if (id !== t.idFromFilename) {
      at("invariant-1", `frontmatter id is ${JSON.stringify(id)} but the file name requires ${JSON.stringify(t.idFromFilename)}`);
    }
  }

  // 必填标量
  const title = fm["title"];
  if (typeof title !== "string" || title.trim() === "") {
    at("field", "missing the required field \"title\", or it is not a non-empty string");
  } else if (title.includes("\n") || title.trim().length > 200) {
    at("field", "title must be a single line of 1-200 characters after trimming");
  }

  const status = fm["status"];
  const isStatus = typeof status === "string" && (STATUSES as readonly string[]).includes(status);
  if (!isStatus) at("field", `status must be one of ${STATUSES.join(" / ")}; found ${JSON.stringify(status)}`);

  // 不变量 2 —— resolution present iff closed
  const resolution = fm["resolution"];
  // 字段本身的类型与取值先查，**与 status 无关**。嵌在 closed 分支里的话，
  // `open` + `resolution: 123` 只会报出组合问题（invariant-2），而那条是
  // ls 容忍的，于是这个非法值一路通过、在读取侧被静默丢掉（Codex 第三轮评审）。
  if (resolution !== undefined
      && (typeof resolution !== "string" || !(RESOLUTIONS as readonly string[]).includes(resolution))) {
    at("field", `resolution must be one of ${RESOLUTIONS.join(" / ")}; found ${JSON.stringify(resolution)}`);
  }
  // 再查它与 status 的搭配（不变量 2）
  if (status === "closed") {
    if (resolution === undefined) at("invariant-2", "status is closed but resolution is missing");
  } else if (resolution !== undefined) {
    at("invariant-2", `resolution may only appear when status is closed; status is ${JSON.stringify(status)}`);
  }

  // 不变量 3 —— assignee present iff in_progress，closed 时可选
  const assignee = fm["assignee"];
  if (status === "in_progress" && assignee === undefined) {
    at("invariant-3", "status is in_progress but assignee is missing");
  }
  if (status === "open" && assignee !== undefined) {
    at("invariant-3", "assignee must be absent when status is open (reopen clears resolution and assignee together)");
  }

  // 不变量 8 —— actor 语法
  if (assignee !== undefined) {
    if (typeof assignee !== "string" || !ACTOR_RE.test(assignee)) {
      at("invariant-8", `assignee ${JSON.stringify(assignee)} does not match spec §5.4 (1-64 characters, no whitespace or colon)`);
    }
  }
  for (const line of logLines(t.body)) {
    const parsed = parseLogLine(line);
    if (!parsed.ok) {
      at("field", `Log line does not match the spec §5.3.3 grammar: ${parsed.error}  --  ${line}`);
      continue;
    }
    if (!ACTOR_RE.test(parsed.actor)) {
      at("invariant-8", `Log line actor ${JSON.stringify(parsed.actor)} does not match spec §5.4`);
    }
  }

  // 不变量 6 —— updated >= created
  const created = fm["created"];
  const updated = fm["updated"];
  for (const [name, v] of [["created", created], ["updated", updated]] as const) {
    if (typeof v !== "string" || !TIMESTAMP_RE.test(v)) {
      at("field", `${name} must be an RFC 3339 UTC second-precision timestamp such as 2026-09-14T09:00:00Z; found ${JSON.stringify(v)}`);
    }
  }
  if (typeof created === "string" && typeof updated === "string" && updated < created) {
    at("invariant-6", `updated (${updated}) is earlier than created (${created})`);
  }

  // 可选字段的类型与取值
  const rank = fm["rank"];
  if (rank !== undefined && (typeof rank !== "string" || !RANK_RE.test(rank))) {
    at("field", `rank must be a string matching ${RANK_RE.source}; found ${JSON.stringify(rank)} (an unquoted 007 is read by YAML as the number 7)`);
  }
  const verify = fm["verify"];
  if (verify !== undefined && typeof verify !== "string") at("field", "verify must be a string");
  const labels = fm["labels"];
  if (labels !== undefined) {
    if (!Array.isArray(labels)) at("field", "labels must be a list");
    else {
      const seen = new Set<string>();
      for (const l of labels) {
        if (typeof l !== "string" || !LABEL_RE.test(l)) at("field", `label ${JSON.stringify(l)} does not match spec §5.2 field 10`);
        else if (seen.has(l)) at("field", `label ${JSON.stringify(l)} is duplicated`);
        else seen.add(l);
      }
    }
  }
  // 引用字段：类型**和**语法都要查。只查类型的话，blocked_by: [123] 会一路通过，
  // 而读取侧按 spec §5.2 只收字符串，于是那个 123 无声消失——没有任何一层会说。
  const parent = fm["parent"];
  if (parent !== undefined) {
    if (typeof parent !== "string") at("field", "parent must be a string");
    else if (!ID_RE.test(parent)) {
      at("field", `parent ${JSON.stringify(parent)} does not match the spec §4 form <prefix>-<six base36 chars>`);
    }
  }
  const blockedBy = fm["blocked_by"];
  if (blockedBy !== undefined) {
    if (!Array.isArray(blockedBy)) at("field", "blocked_by must be a list");
    else {
      // 不查重复：spec §5.2 字段 7 只要求「引用存在的任务、不含自身、无环」，
      // 明文写「no duplicates」的是 labels（字段 10），不是 blocked_by。
      // 重复项语义上也无害——blocked(t) 只看有没有未关闭的。照着 labels
      // 加一条规格没有的约束，会让完全合规的文件被我们判非法（实测
      // `add --blocked-by A A` 因此从退出 0 变成退出 1）。
      for (const b of blockedBy) {
        if (typeof b !== "string" || !ID_RE.test(b)) {
          at("field", `blocked_by entry ${JSON.stringify(b)} does not match the spec §4 form <prefix>-<six base36 chars>`);
        }
      }
    }
  }

  return out;
}

/** 取 ## Log 小节下的列表项。续行（缩进两格）不是新的一项。 */
export function logLines(body: string): string[] {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === "## Log");
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("## ")) break;
    if (line.startsWith("- ")) out.push(line);
  }
  return out;
}

export type ParsedLogLine =
  | { ok: true; timestamp: string; actor: string; verb: string; args: Record<string, string>; text?: string }
  | { ok: false; error: string };

/**
 * 按 spec §5.3.3 的语法解析一行 Log：
 *
 *     - <timestamp> <actor> <verb>[ <key>=<value>]*[: <text>]
 *
 * 严格解析是有意的，而且是检出「actor 含空格」的唯一途径：空格就是字段分隔符，
 * 所以 `- <ts> Sean Zhang created` 里的 actor 看起来合法（就是 "Sean"）。
 * 线索在后面——verb 之后只能是 key=value 或以 ": " 开头的文本，而 "created"
 * 两者都不是。§5.4 说空格「会让 Log 行的解析错位」，错位的证据就在这里。
 */
export function parseLogLine(line: string): ParsedLogLine {
  if (!line.startsWith("- ")) return { ok: false, error: 'does not start with "- "' };
  const rest = line.slice(2);

  // 文本段以 ": " 开始，且它之前不能再有空格分隔的非 key=value 记号
  const colonAt = rest.indexOf(": ");
  const head = colonAt < 0 ? rest : rest.slice(0, colonAt);
  const text = colonAt < 0 ? undefined : rest.slice(colonAt + 2);

  const parts = head.split(" ").filter((p) => p !== "");
  if (parts.length < 3) return { ok: false, error: "needs at least a timestamp, an actor and a verb" };

  const [timestamp, actor, verb, ...tail] = parts as [string, string, string, ...string[]];
  if (!TIMESTAMP_RE.test(timestamp)) {
    return { ok: false, error: `first field ${JSON.stringify(timestamp)} is not an RFC 3339 UTC second-precision timestamp` };
  }
  const args: Record<string, string> = {};
  for (const tok of tail) {
    const eq = tok.indexOf("=");
    if (eq < 1) {
      return {
        ok: false,
        error: `only key=value tokens may follow the verb, but found ${JSON.stringify(tok)} ` +
          `(an actor containing a space shows up exactly like this)`,
      };
    }
    args[tok.slice(0, eq)] = tok.slice(eq + 1);
  }
  return text === undefined
    ? { ok: true, timestamp, actor, verb, args }
    : { ok: true, timestamp, actor, verb, args, text };
}
