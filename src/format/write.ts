// src/format/write.ts
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";
import { withLock } from "../fs/lock.ts";
import { writeFileAtomic } from "../fs/atomic.ts";
import { readTasks } from "./read.ts";
import { emitTask, nextRank, type NewTask } from "./emit.ts";
import { newIdBody, makeId } from "../domain/id.ts";
import { splitEnvelope } from "./envelope.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import type { Ledger } from "./discover.ts";
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
  const common = gitCommonDir(ledger.root);
  return common === null
    ? join(ledger.dir, ".cache", "lock")
    : join(common, "todopi", "leases", "lock");
}

function gitCommonDir(root: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out === "") return null;
    return isAbsolute(out) ? out : resolve(root, out);
  } catch {
    return null;                     // 不在 git 仓库里（spec §1.3 允许）
  }
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
  return withLock(lockPathFor(ledger), () => {
    const existing = readTasks(ledger);
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
      now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
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
    return candidate;
  });
}

/** 把一段任务文本解析成 TaskFile。失败时返回说明问题的字符串。 */
function parseCandidate(relPath: string, id: string, text: string): TaskFile | string {
  const env = splitEnvelope(text);
  if (env === null) return "the text is not a valid envelope";
  const parsed = parseFrontmatter(env.head);
  if (!parsed.ok) return parsed.error;
  return { path: relPath, idFromFilename: id, frontmatter: parsed.data, body: env.body, raw: text };
}
