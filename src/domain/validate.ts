// src/domain/validate.ts
// 单文件不变量。纯函数：不 import node:fs，用例直接构造对象即可（src/ARCHITECTURE.md）。
import {
  ACTOR_RE, ID_RE, KNOWN_FIELDS, LABEL_RE, RANK_RE, RESOLUTIONS, STATUSES, TIMESTAMP_RE,
  type TaskFile,
} from "./types.ts";
import type { Finding } from "./findings.ts";
import { validateGraph } from "./graph.ts";
import { sectionLines } from "./acceptance.ts";

const CONFLICT_RE = /^(<<<<<<<|=======|>>>>>>>)/m;

export function validateFile(t: TaskFile): Finding[] {
  const out: Finding[] = [];
  const at = (rule: Finding["rule"], message: string) => out.push({ rule, path: t.path, message });
  const fm = t.frontmatter;

  // 不变量 7 —— 冲突标记。先查，因为它会让其他所有检查的结果变得没有意义。
  if (CONFLICT_RE.test(t.raw) || CONFLICT_RE.test(t.body)) {
    at("invariant-7", "file contains unresolved git conflict markers (<<<<<<< / ======= / >>>>>>> at line start)");
  }

  // spec §5.1：UTF-8。读取端把非法字节换成了 U+FFFD，内容已经不是原样——报告，但不挡后面的检查。
  if (t.invalidUtf8 === true) at("envelope", "the file is not valid UTF-8 (spec §5.1)");

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
  for (const { head: line, continuation } of logEntries(t.body)) {
    const parsed = parseLogLine(line);
    if (!parsed.ok) {
      at("field", `Log line does not match the spec §5.3.3 grammar: ${parsed.error}  --  ${line}`);
      continue;
    }
    // spec §5.3.3：续行是 <text> 的延续。头行没有 `: <text>`，续行就无所归属——
    // 读者若照样拼上去，一条 `created` 就凭空带上了正文（F08 评审构造的伪造）。
    if (parsed.text === undefined && continuation.length > 0) {
      at("field", `Log line has continuation lines but no ": <text>" for them to continue (spec §5.3.3)  --  ${line}`);
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
  // 按字符串比先后只在两边都是规范形态（UTC 秒级 Z）时成立；不规范的已经由上面那条报了，再比只会误报——
  // `…+00:00` 与同一时刻的 `…Z` 按字符串比是「更早」（F30 实测）
  if (typeof created === "string" && typeof updated === "string" && TIMESTAMP_RE.test(created) && TIMESTAMP_RE.test(updated)
    && updated < created) {
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

/**
 * 取 `## Log` 小节下的列表项。续行（缩进两格）不是新的一项。
 *
 * 小节查找共用 `acceptance.ts` 的 `sectionLines`——验收标准用的是同一套逻辑，
 * 而 F09 的勾选写入端还要靠它定位具体行。两份实现迟早会漂。
 */
export function logLines(body: string): string[] {
  return sectionLines(body, "## Log").filter((l) => !l.fenced).map((l) => l.text).filter((t) => t.startsWith("- "));
}

/** Log 的一条：第一行（含 `- `）加上紧随其后的续行（已去掉两格缩进）。 */
export type LogEntry = { head: string; continuation: string[] };

/**
 * 取 `## Log` 小节的条目，**续行并进它上面那一条**。
 *
 * spec §5.3.3：「A multi-line text continues on following lines indented by two
 * spaces; readers join them with `\n`」。`logLines` 只取 `- ` 开头的行，续行被
 * 丢掉——F07 的 forced done 会把 verify 输出的最后 512 字节作为续行写进来，而
 * `show` 要的是完整的那一条。
 *
 * **不改 `logLines`**：`isUnverified` 与 doctor 只关心每条的第一行，改它会牵连
 * 那两处。两者在「有几条、每条第一行是什么」上必须一致，用例钉着这一点。
 *
 * 空行结束续行：写入端把输出里的空行写成两个空格（仍然是续行），真正的空行只会是
 * 条目之间的分隔。续行只去掉**两格**，更深的缩进是原文的一部分。
 */
export function logEntries(body: string): LogEntry[] {
  const out: LogEntry[] = [];
  let current: LogEntry | null = null;
  for (const { text, fenced } of sectionLines(body, "## Log")) {
    // 顶层围栏里的是示例，不是事件（F10 第二轮评审：围栏里一行假 done 曾被读成真事件）。
    if (fenced) { current = null; continue; }
    if (text.startsWith("- ")) {
      current = { head: text, continuation: [] };
      out.push(current);
    } else if (current !== null && text.startsWith("  ")) {
      current.continuation.push(text.slice(2));
    } else {
      current = null;
    }
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

/**
 * 写入前的门禁：候选文件自身的校验，加上**这次写入引入的**图问题。
 *
 * 图问题要做差集，不能直接看 `validateGraph([...existing, candidate])`：
 * 账本里可能本来就有悬空引用，那不该挡住一次与它无关的写入——而 doctor 仍然
 * 会报那个既存问题。也不能只看候选自己那一条：一个环由多个文件共同构成，
 * 报出来的 finding 可能挂在环上任何一个文件上。按 finding 的完整内容做差集，
 * 新出现的才算这次引入的。
 *
 * 返回 null 表示放行，否则是拼好的拒绝理由。
 *
 * 抽出来是因为 add / claim / release 必须用**同一套**门禁：复制一份，两边迟早
 * 会对同一个账本给出不同的结论，而那时谁对谁错没人说得清。
 */
export function validateWrite(candidate: TaskFile, existing: TaskFile[]): string | null {
  const key = (f: Finding) => [f.path, f.rule, f.message].join(" | ");
  const before = new Set(validateGraph(existing).map(key));
  const introduced = validateGraph([...existing, candidate]).filter((f) => !before.has(key(f)));
  const findings = [...validateFile(candidate), ...introduced];
  return findings.length === 0 ? null : findings.map((f) => `${f.rule}: ${f.message}`).join("; ");
}

/**
 * spec §5.2：不认识的键（不是 `x-` 开头的扩展键）写入端必须保留，读取端 SHOULD 警告——多半是后来的
 * 次版本加的字段，或者拼错了。只是警告：它不让 doctor 失败（FR-Q1 的「未知键」检查）。
 */
export function unknownKeys(t: TaskFile): string[] {
  const known = new Set<string>(KNOWN_FIELDS);
  return Object.keys(t.frontmatter).filter((k) => !known.has(k) && !k.startsWith("x-"));
}
