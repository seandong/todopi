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
    at("invariant-7", "文件含未解决的 git 冲突标记（行首的 <<<<<<< / ======= / >>>>>>>）");
  }

  // 不变量 1 —— 解析成功且 id 与文件名一致
  if (t.parseError) {
    at("envelope", t.parseError);
    return out;                       // 解析都没成功，后面的检查无从谈起
  }
  const id = fm["id"];
  if (typeof id !== "string") {
    at("invariant-1", "缺少必填字段 id，或它不是字符串");
  } else {
    if (!ID_RE.test(id)) at("field", `id ${JSON.stringify(id)} 不符合 spec §4 的形式 <prefix>-<六位 base36>`);
    if (id !== t.idFromFilename) {
      at("invariant-1", `frontmatter 的 id 是 ${JSON.stringify(id)}，文件名要求它是 ${JSON.stringify(t.idFromFilename)}`);
    }
  }

  // 必填标量
  const title = fm["title"];
  if (typeof title !== "string" || title.trim() === "") {
    at("field", "缺少必填字段 title，或它不是非空字符串");
  } else if (title.includes("\n") || title.trim().length > 200) {
    at("field", "title 必须是单行、1–200 个字符（去除首尾空白后）");
  }

  const status = fm["status"];
  const isStatus = typeof status === "string" && (STATUSES as readonly string[]).includes(status);
  if (!isStatus) at("field", `status 必须是 ${STATUSES.join(" / ")} 之一，当前是 ${JSON.stringify(status)}`);

  // 不变量 2 —— resolution present iff closed
  const resolution = fm["resolution"];
  if (status === "closed") {
    if (resolution === undefined) at("invariant-2", "status 是 closed，但缺少 resolution");
    else if (typeof resolution !== "string" || !(RESOLUTIONS as readonly string[]).includes(resolution)) {
      at("field", `resolution 必须是 ${RESOLUTIONS.join(" / ")} 之一，当前是 ${JSON.stringify(resolution)}`);
    }
  } else if (resolution !== undefined) {
    at("invariant-2", `resolution 只能在 status 为 closed 时出现，当前 status 是 ${JSON.stringify(status)}`);
  }

  // 不变量 3 —— assignee present iff in_progress，closed 时可选
  const assignee = fm["assignee"];
  if (status === "in_progress" && assignee === undefined) {
    at("invariant-3", "status 是 in_progress，但缺少 assignee");
  }
  if (status === "open" && assignee !== undefined) {
    at("invariant-3", "status 是 open 时 assignee 必须缺席（reopen 要同时清除 resolution 与 assignee）");
  }

  // 不变量 8 —— actor 语法
  if (assignee !== undefined) {
    if (typeof assignee !== "string" || !ACTOR_RE.test(assignee)) {
      at("invariant-8", `assignee ${JSON.stringify(assignee)} 不符合 spec §5.4（1–64 个字符，不含空白与冒号）`);
    }
  }
  for (const line of logLines(t.body)) {
    const parsed = parseLogLine(line);
    if (!parsed.ok) {
      at("field", `Log 行不符合 spec §5.3.3 的语法：${parsed.error}  ——  ${line}`);
      continue;
    }
    if (!ACTOR_RE.test(parsed.actor)) {
      at("invariant-8", `Log 行的 actor ${JSON.stringify(parsed.actor)} 不符合 spec §5.4`);
    }
  }

  // 不变量 6 —— updated >= created
  const created = fm["created"];
  const updated = fm["updated"];
  for (const [name, v] of [["created", created], ["updated", updated]] as const) {
    if (typeof v !== "string" || !TIMESTAMP_RE.test(v)) {
      at("field", `${name} 必须是 RFC 3339 的 UTC 秒级时间戳（形如 2026-09-14T09:00:00Z），当前是 ${JSON.stringify(v)}`);
    }
  }
  if (typeof created === "string" && typeof updated === "string" && updated < created) {
    at("invariant-6", `updated (${updated}) 早于 created (${created})`);
  }

  // 可选字段的类型与取值
  const rank = fm["rank"];
  if (rank !== undefined && (typeof rank !== "string" || !RANK_RE.test(rank))) {
    at("field", `rank 必须是匹配 ${RANK_RE.source} 的字符串，当前是 ${JSON.stringify(rank)}（不带引号的 007 会被 YAML 读成数字 7）`);
  }
  const verify = fm["verify"];
  if (verify !== undefined && typeof verify !== "string") at("field", "verify 必须是字符串");
  const labels = fm["labels"];
  if (labels !== undefined) {
    if (!Array.isArray(labels)) at("field", "labels 必须是列表");
    else {
      const seen = new Set<string>();
      for (const l of labels) {
        if (typeof l !== "string" || !LABEL_RE.test(l)) at("field", `标签 ${JSON.stringify(l)} 不符合 spec §5.2 字段 10`);
        else if (seen.has(l)) at("field", `标签 ${JSON.stringify(l)} 重复`);
        else seen.add(l);
      }
    }
  }
  const parent = fm["parent"];
  if (parent !== undefined && typeof parent !== "string") at("field", "parent 必须是字符串");
  const blockedBy = fm["blocked_by"];
  if (blockedBy !== undefined && !Array.isArray(blockedBy)) at("field", "blocked_by 必须是列表");

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
  if (!line.startsWith("- ")) return { ok: false, error: "不是以 \"- \" 开头的列表项" };
  const rest = line.slice(2);

  // 文本段以 ": " 开始，且它之前不能再有空格分隔的非 key=value 记号
  const colonAt = rest.indexOf(": ");
  const head = colonAt < 0 ? rest : rest.slice(0, colonAt);
  const text = colonAt < 0 ? undefined : rest.slice(colonAt + 2);

  const parts = head.split(" ").filter((p) => p !== "");
  if (parts.length < 3) return { ok: false, error: "至少要有时间戳、actor 与动词三段" };

  const [timestamp, actor, verb, ...tail] = parts as [string, string, string, ...string[]];
  if (!TIMESTAMP_RE.test(timestamp)) {
    return { ok: false, error: `第一段 ${JSON.stringify(timestamp)} 不是 RFC 3339 的 UTC 秒级时间戳` };
  }
  const args: Record<string, string> = {};
  for (const tok of tail) {
    const eq = tok.indexOf("=");
    if (eq < 1) {
      return {
        ok: false,
        error: `动词之后只能是 key=value，但出现了 ${JSON.stringify(tok)}` +
          `（若 actor 含空格，错位就表现为这一条）`,
      };
    }
    args[tok.slice(0, eq)] = tok.slice(eq + 1);
  }
  return text === undefined
    ? { ok: true, timestamp, actor, verb, args }
    : { ok: true, timestamp, actor, verb, args, text };
}
