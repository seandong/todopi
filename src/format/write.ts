// src/format/write.ts
import { headingIndex, sectionEnd, structure } from "../markdown/sections.ts";
import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { withLock } from "../fs/lock.ts";
import { writeFileAtomic } from "../fs/atomic.ts";
import { readTasks } from "./read.ts";
import { emitTask, emitFrontmatter, nextRank, type NewTask } from "./emit.ts";
import { newIdBody, makeId } from "./id.ts";
import { leasePaths } from "./lease.ts";
import { splitEnvelope } from "./envelope.ts";
import { commentsIn, entrySource, parseFrontmatter } from "./frontmatter.ts";
import { assertWritable, type Ledger } from "./discover.ts";
import type { TaskFile } from "../domain/types.ts";
import { EXIT, CliError } from "../exit.ts";

/**
 * 校验器由调用方注入，而不是 format/ 直接 import domain/。
 *
 * ARCHITECTURE.md 定义 `format/` 只依赖 `node:*`、`yaml`、`fs/`——它懂的是磁盘
 * 格式，不懂「什么算合法」。把 domain 的判断作为参数传进来，依赖方向才是对的，
 * 而且让写入入口可以在不同场景下用不同的校验强度（add 要带图校验，
 * 将来的 edit 可能只校验被改的那一个文件）。
 *
 * 返回 null 表示通过，返回字符串表示拒绝的原因。
 */
export type Validate = (candidate: TaskFile, existing: TaskFile[]) => string | null;

export type CreateContext = {
  /** 生成一个在当前 tasks/ 里不冲突的 id。可注入 body 生成器供测试。 */
  newId: (gen?: () => string) => string;
  /** 分配排在末尾的 rank。确定性的：同一次创建内重复调用返回同一个值。 */
  nextRank: () => string;
  /** 本次写入的时间戳，created 与 updated 用同一个值。 */
  now: string;
};

/**
 * 锁的位置。spec §8 定义 lease 目录为 `<git-common-dir>/todopi/leases/`，
 * 锁是该目录下的 `lock`；无 git 时是 `.todopi/.cache/lock`（注意这一侧**不**在
 * leases/ 里，规格本身是这么不对称的）。
 *
 * 路径必须与规格逐字一致：第三方按规格实现会去 `.git/todopi/leases/lock` 取锁，
 * 我们若用 `.git/todopi/lock`，两边各锁各的，完全不互斥。
 *
 * git rev-parse --git-common-dir 返回的是**相对路径**（仓库根 `.git`，
 * 子目录 `../.git`），必须相对仓库根解析成绝对路径——实测过，直接当路径用会错。
 */
export function lockPathFor(ledger: Ledger): string {
  return leasePaths(ledger).lockPath;
}


/**
 * 创建一个任务。**整段「扫描 → 生成 → 写」在锁内完成**，因为两个并发的 add
 * 若各自读到同一个「最后的 rank」就会分配出重复的 rank，而各自生成的 id 也可能
 * 在写入的瞬间才发生碰撞。实测无锁时 20 个并发进程只产出 9 个文件。
 */
export function createTask(
  ledger: Ledger,
  make: (ctx: CreateContext) => NewTask,
  validate: Validate,
): TaskFile {
  return withLedgerLock(ledger, () => createTaskUnlocked(ledger, make, validate));
}

/**
 * createTask 的锁内部分。**调用方必须已经持有账本的写锁**（withLedgerLock）：一次要建多个任务、且「建不建」取决于
 * 锁内读到的账本时用（import：两个并发的导入各自判定「还没导入过」就会建出两份）。
 */
export function createTaskUnlocked(
  ledger: Ledger,
  make: (ctx: CreateContext) => NewTask,
  validate: Validate,
  /**
   * 调用方维护的账本现状（持锁期间它就是磁盘真相）：一次建上千个任务时不必每建一个都重读整个账本
   * （import beads）。建好的任务会追加进这个数组。不给就读盘。
   */
  known?: TaskFile[],
): TaskFile {
  {
    const existing = known ?? readTasks(ledger);
    const takenIds = new Set(existing.map((t) => t.idFromFilename));
    const lastRank = existing
      .map((t) => t.frontmatter["rank"])
      .filter((r): r is string => typeof r === "string")
      .sort()
      .at(-1) ?? null;

    const ctx: CreateContext = {
      newId: (gen = newIdBody) => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const id = makeId(ledger.config.id_prefix, gen());
          if (!takenIds.has(id)) return id;
        }
        throw new Error("Could not generate a free task id after 100 attempts");
      },
      // generateKeyBetween 对同一个 lastRank 是确定性的（实测），所以这里不缓存：
      // 重复调用返回同一个值，加一层 ??= 只是省一次计算而看起来像在防什么。
      nextRank: () => nextRank(lastRank),
      now: nowStamp(),
    };

    const task = make(ctx);
    const path = join(ledger.dir, "tasks", `${task.id}.md`);
    if (existsSync(path)) throw new Error(`Refusing to overwrite an existing task at ${path}`);

    // **校验在写入之前，而且用的是调用方给的完整校验器。** 这个入口叫
    // 「读-校验-写」，所以 validate 必须真的发生：只确认 YAML 能解析，不等于任务
    // 符合规格。FR-T1 的验收是「文件存在、**通过 doctor**」——一条写出了 doctor
    // 不通过的文件却退出 0 的命令，是在把问题推给下一个人。
    const text = emitTask(task);
    const relPath = join("tasks", `${task.id}.md`);
    const candidate = parseCandidate(relPath, task.id, text);
    if (typeof candidate === "string") {
      throw new CliError(EXIT.usage, `Refusing to write a task that would not pass doctor: ${candidate}`);
    }
    const rejected = validate(candidate, existing);
    if (rejected !== null) {
      throw new CliError(EXIT.usage, `Refusing to write a task that would not pass doctor: ${rejected}`);
    }

    assertWritable(ledger);
    writeFileAtomic(path, text);

    // 写完读回一次真实文件，确认落盘的内容与我们写的一致。不一致只可能是文件
    // 系统层面的问题，但那正是最值得早发现的一类。
    //
    // 这里**不**在失败时 unlink：我们持锁，而锁内没有别人能合法创建这个路径，
    // 所以理论上删的是自己的文件——但「理论上」在并发代码里不够。留下文件并让
    // doctor 报告它，比冒险删掉一个可能属于别人的文件安全；错误信息会点名路径。
    const onDisk = readFileSync(path, "utf8");
    if (onDisk !== text) {
      throw new Error(
        `The task written at ${path} does not match what was emitted. ` +
          `The file has been left in place for inspection; run "todopi doctor" to see its state.`,
      );
    }
    known?.push(candidate);
    return candidate;
  }
}

/**
 * 不写盘，只把一个 NewTask 发射再读回成 TaskFile（失败时返回说明）。批量写入前预检用：import beads 要在写第一个文件之前
 * 确认每一个都写得下去，否则中途失败会留下半个导入（F20 评审）。
 */
export function candidateFor(task: NewTask): TaskFile | string {
  return parseCandidate(join("tasks", `${task.id}.md`), task.id, emitTask(task));
}

/** 把一段任务文本解析成 TaskFile。失败时返回说明问题的字符串。 */
function parseCandidate(relPath: string, id: string, text: string): TaskFile | string {
  const env = splitEnvelope(text);
  if (env === null) return "the text is not a valid envelope";
  const parsed = parseFrontmatter(env.head);
  if (!parsed.ok) return parsed.error;
  return { path: relPath, idFromFilename: id, frontmatter: parsed.data, body: env.body, raw: text };
}

/** 拿着账本的写锁跑一段。调用方需要「读 → 判断 → 可能写多个文件」落在一次持锁内时用它。 */
export function withLedgerLock<T>(ledger: Ledger, fn: () => T): T {
  // 所有改账本的写都经过这把锁：版本更高的账本在拿锁之前就拒绝（拿锁本身也是写）；拿到锁之后再看一次磁盘——
  // 等锁的时候账本可能被新版 todopi 升了版
  assertWritable(ledger);
  return withLock(lockPathFor(ledger), () => {
    assertWritable(ledger);
    return fn();
  });
}

/** 准备好的一次任务改写：candidate 已通过校验，commit() 才落盘。 */
export type PreparedUpdate = { candidate: TaskFile; commit: () => void };

/**
 * 构造并**校验**一次任务改写，但不写任何东西。调用方拿到 `commit()` 自行决定何时落盘。
 *
 * 分成两步是 Codex 评审 F05 的结论：claim 要在写任务文件之前先写租约，
 * 而「先写租约」不能发生在校验之前——spec §6.1 说被拒绝的迁移**什么都不改**，
 * 而第一版里一个校验失败的 claim 已经把租约落盘了。
 * 把「构造+校验」与「落盘」分开之后，顺序天然是：读 → 决策 → 构造并校验 → 写。
 *
 * **必须在持锁状态下调用**，且 `existing` 必须是锁内读到的那一份：
 * 锁外读到的快照到拿到锁时可能已经变了。
 */
export function prepareUpdate(
  ledger: Ledger,
  existing: TaskFile[],
  id: string,
  next: {
    frontmatter: Record<string, unknown>;
    appendLog?: string;
    /**
     * 对正文的变换，在追加 Log **之前**应用。`check` 翻转一个方括号并记一行
     * `check ac=n`，两者必须落在同一次写入里——分两次写，中间崩了就是一个勾了却
     * 没记录的标准，或者记了却没勾。
     */
    body?: (body: string) => string;
  },
  validate: Validate,
  now: string,
): PreparedUpdate {
  const target = existing.find((t) => t.idFromFilename === id);
  if (target === undefined) {
    throw new CliError(EXIT.usage, `No task ${id} in this ledger. Run "todopi ls" to see what is there.`);
  }
  if (target.parseError !== undefined) {
    throw new CliError(EXIT.usage,
      `Task ${id} cannot be read: ${target.parseError}. Run "todopi doctor" to see what is wrong with it.`);
  }

  // 文件里有非法 UTF-8 字节：解码时已换成 U+FFFD，整文件写回就改掉了原字节（包括 Log）。拒绝，让人先修
  // （F13 评审二轮在 doctor --fix 上发现，所有写入口同理）。
  if (target.invalidUtf8 === true) {
    throw new CliError(EXIT.usage, `Refusing to write ${relPathOf(id)}: the file is not valid UTF-8 (spec §5.1); fix it first.`);
  }

  // **写回时把正文规范化成 LF**（spec §5.1：行尾 LF，无 BOM）。
  //
  // 读取侧对 CRLF 是容错的（`sectionLines` 会去掉行尾的 \r），否则一份 CRLF
  // 文件会让门禁静默失效。但容错读取不等于把不合规的行尾一路带回磁盘——
  // 我一度以为「写回自然回到 LF」，实测并没有：原样带回的 body 里 \r 还在
  // （Codex 第二轮评审）。写者 MUST 发 LF，所以在这里落实。
  const rawBody = target.body.replace(/\r\n/g, "\n");
  const edited = next.body === undefined ? rawBody : next.body(rawBody);
  const body = next.appendLog === undefined ? edited : appendLogLine(edited, next.appendLog);
  const text = `---\n${emitFrontmatter({ ...next.frontmatter, updated: now })}---\n${body}`;

  // **校验在写入之前**，与 createTask 同样的理由（F03 第二轮评审的结论）：
  // 校验放在写之后，失败时磁盘上已经留下了损坏文件。
  const relPath = join("tasks", `${id}.md`);
  const candidate = parseCandidate(relPath, id, text);
  if (typeof candidate === "string") {
    throw new CliError(EXIT.usage, `Refusing to write a task that would not pass doctor: ${candidate}`);
  }
  const others = existing.filter((t) => t.idFromFilename !== id);
  const rejected = validate(candidate, others);
  if (rejected !== null) {
    throw new CliError(EXIT.usage, `Refusing to write a task that would not pass doctor: ${rejected}`);
  }

  return {
    candidate,
    commit: () => { assertWritable(ledger); writeFileAtomic(join(ledger.dir, "tasks", `${id}.md`), text); },
  };
}

/**
 * 读-改-写一个既有任务。整段在锁内完成，理由与 createTask 相同：
 * 两个并发的写者若各自读到同一份旧内容，后写的会无声覆盖先写的。
 *
 * `mutate` 返回**完整的新 frontmatter**，不是一个补丁。补丁语义需要定义
 * 「怎么删一个键」，而 `undefined` 与「键不存在」在这里不是一回事；返回全量
 * 则不需要这层约定。代价是调用方要把不改的键原样带回来——那正是 spec §5.2
 * 字段 11 要求的「保留你不认识的条目」，所以这个代价是它该付的。
 *
 * `updated` 由这一层统一刷新（spec §6.3：每次写入都要刷新，只动正文也要）。
 *
 * 正文默认原样带回：只有 frontmatter 被重新发射。要追加 Log 行的调用方用
 * `appendLog` 返回值，由这一层按 §5.3.3 放到 `## Log` 小节末尾。
 *
 * 需要在同一次持锁内做更多事（比如同时写租约）的命令用
 * `withLedgerLock` + `prepareUpdate`，不要用这个便捷入口。
 */
export function updateTask(
  ledger: Ledger,
  id: string,
  mutate: (t: TaskFile, now: string) => Parameters<typeof prepareUpdate>[3],
  validate: Validate,
): TaskFile {
  return withLedgerLock(ledger, () => {
    const existing = readTasks(ledger);
    const target = existing.find((t) => t.idFromFilename === id);
    if (target === undefined) {
      throw new CliError(EXIT.usage, `No task ${id} in this ledger. Run "todopi ls" to see what is there.`);
    }
    const now = nowStamp();
    const prepared = prepareUpdate(ledger, existing, id, mutate(target, now), validate, now);
    prepared.commit();
    return prepared.candidate;
  });
}

/** RFC 3339 UTC 秒级，与 spec §5.2 字段 12 的形状一致。 */
export function nowStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * 按 spec §5.3.3 把一行追加到 `## Log` 小节末尾（最新的在最后）。
 *
 * 调用方给的是 `<ts> <actor> <verb>...`，**不带 `- ` 前缀**——与 emitTask 的
 * `log: string[]` 同一个约定，那边也是由发射器补前缀的。两处约定不一致的话，
 * 写出来的行会缺前缀而不再是合法的列表项（第一版就是这么错的）。
 * 没有该小节就建一个——`add` 总会写出它，但手写的文件不一定有。
 *
 * 续行（缩进两格）属于前一项，所以「末尾」是整个小节的末尾，
 * 不是最后一个 `- ` 行的后面。
 */
/** 正文里有没闭合的块时的报错；edit -d 用同一句。 */
export const UNCLOSED = (at: number) =>
  `the task body has a code fence or HTML block opened at body line ${at + 1} that is never closed, so the `
  + "lines after it cannot be placed safely (spec §5.3). Close it (for a tag like <div>, a blank line after its "
  + "content ends it), then retry.";

function appendLogLine(body: string, line: string): string {
  const lines = body.split("\n");
  // **顶格精确匹配，与读取端（sectionLines）同一个判据。** 曾用 .trim()：一段缩进
  // 的 `   ## Log`（合法的未识别正文）被当成 Log 往里追加，读者却看不见——note 成功、
  // doctor 通过、show 一条都没有（F09 评审实测）。找不到真正的小节就在末尾新建一节，
  // 那段缩进的文字按 spec §5.3 原样保留。
  const st = structure(lines);
  // 正文里有没闭合的块（围栏，或吞掉了后面几行的 HTML 块）时不写。读取端把它的开头当普通文字，所以
  // 此刻追加的事件看得见；可一旦有人补上结束标记，事件就落进了块里、从 Log 里消失（F10 第四轮评审）。
  // spec §5.3：这样的正文，写入端不改写任何小节。
  if (st.reparsedAt >= 0) throw new CliError(EXIT.usage, `Refusing to append to the Log: ${UNCLOSED(st.reparsedAt)}`);
  const start = headingIndex(lines, st, "## Log");
  // 多行文本按 §5.3.3 的续行规则：第一行是列表项，后面每行缩进两格。
  // FR-D4a 的「强制关闭时记录输出尾部」就走这条路。
  const [first, ...rest] = line.split("\n");
  const item = [`- ${first}`, ...rest.map((l) => `  ${l}`)].join("\n");
  let out: string;
  let at: number;
  if (start < 0) {
    // **原正文一个字节都不动，只补分隔所需的换行。** 曾先 `replace(/\s*$/, "")` 再拼，
    // 于是末尾那段未识别小节的尾随空格与空行被削掉了（spec §5.3：writers MUST
    // preserve；F09 第二轮评审实测）。
    const sep = body === "" || body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
    out = `${body}${sep}## Log\n\n${item}\n`;
    at = `${body}${sep}## Log\n\n`.split("\n").length - 1;
  } else {
    let end = start + 1;
    for (let i = start + 1; i < sectionEnd(lines, st, start); i++) {
      if (lines[i]!.trim() !== "") end = i + 1;
    }
    // 紧贴在一个顶层 HTML 块（如 `<div>`）下面的行属于那个块，只有空行才结束它——事件得隔一个空行。
    const glue = st.code[end - 1] === true ? ["", item] : [item];
    lines.splice(end, 0, ...glue);
    out = lines.join("\n");
    at = end + glue.length - 1;
  }
  // **写完问一遍解析器：新事件的每一行都不在代码块或 HTML 块里。** 上面两条是已知的情形；这一条兜住
  // 没想到的——判定者是同一个解析器，而不是再写一份「什么会吞掉下一行」的近似。
  const after = structure(out.split("\n"));
  const span = item.split("\n").length;
  for (let k = at; k < at + span; k++) {
    if (after.code[k] === true || after.reparsedAt >= 0) {
      throw new CliError(EXIT.usage,
        "Refusing to append to the Log: the new entry would land inside a code or HTML block, where readers "
        + "cannot see it. Check the end of the ## Log section, then retry.");
    }
  }
  return out;
}

const relPathOf = (id: string) => join("tasks", `${id}.md`);

/**
 * `doctor --fix` 的规范化重写，分两步：planNormalized 算出新内容并核对，writeNormalized 才写。分开是为了
 * 让调用方先把**所有**文件都算好——rank 回填只有全部能写时才做，写到一半停下会改变显示顺序（F13 评审二轮）。
 *
 * 与 prepareUpdate **有意不同**：不刷新 `updated`、不追加 Log（规格 §6.3 的例外，D034）。`updated` 那一行
 * 保留原文——换个写法（加引号）也是改（D034）。
 *
 * 核对，任何一道不过就不写、返回原因：
 *   1. 文件是合法 UTF-8——否则整文件重写会把非法字节换成 U+FFFD，Log 就不是原来的字节了；
 *   2. 新 frontmatter 读回来恰好是 `want`；
 *   3. 正文只在 `changedLines` 这几行不同。
 */
export function planNormalized(
  t: TaskFile, want: Record<string, unknown>, body: string, changedLines: Set<number>,
): { text: string } | { unchanged: true } | { error: string } {
  if (t.invalidUtf8 === true) return { error: "the file is not valid UTF-8; rewriting it would alter bytes" };
  const env = splitEnvelope(t.raw);
  if (env === null) return { error: "the file has no valid envelope" };
  // 规范形态没有注释：frontmatter 里手写的 YAML 注释（`updated` 那一条的行尾注释除外，它原样保留）会在
  // 重写中丢掉。不丢人写的东西——不重写，报告。
  const kept = "updated" in t.frontmatter ? entrySource(env.head, "updated") ?? "" : "";
  if (commentsIn(env.head).length > commentsIn(kept).length) {
    return { error: "the frontmatter has YAML comments, which the normalized form would drop" };
  }
  let head = emitFrontmatter(want);
  if ("updated" in t.frontmatter) {
    // 原文由 YAML 解析器定位；发射出来的那一行是我们自己的规范形态，认它用正则是可靠的。
    const original = entrySource(env.head, "updated");
    if (original === null) return { error: "could not locate the original `updated` entry to keep it verbatim" };
    head = head.replace(/^updated: [^\n]*$/m, () => original);
  }
  const text = `---\n${head}---\n${body}`;
  const back = splitEnvelope(text);
  const parsed = back === null ? null : parseFrontmatter(back.head);
  if (back === null || parsed === null || !parsed.ok || !isDeepStrictEqual(parsed.data, want)) {
    return { error: "the normalized frontmatter would not read back as the same data" };
  }
  const before = env.body.split("\n"), after = back.body.split("\n");
  if (before.length !== after.length || before.some((l, i) => l !== after[i] && !changedLines.has(i))) {
    return { error: "the body would change outside the lines being normalized" };
  }
  return text === t.raw ? { unchanged: true } : { text };
}

/** 写 planNormalized 算好的内容。调用方必须已持有账本锁。 */
export function writeNormalized(ledger: Ledger, t: TaskFile, text: string): void {
  // 版本闸门在 withLedgerLock；落盘处再挡一次，免得哪个调用方绕过了锁（F25 里 createTask 就是这么漏的）
  assertWritable(ledger);
  writeFileAtomic(join(ledger.dir, relPathOf(t.idFromFilename)), text);
}
