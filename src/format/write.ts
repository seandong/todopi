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

export type CreateContext = {
  /** 生成一个在当前 tasks/ 里不冲突的 id。可注入 body 生成器供测试。 */
  newId: (gen?: () => string) => string;
  /** 分配排在末尾的 rank。确定性的：同一次创建内重复调用返回同一个值。 */
  nextRank: () => string;
  /** 本次写入的时间戳，created 与 updated 用同一个值。 */
  now: string;
};

/**
 * 锁的位置。spec §8：`<git-common-dir>/todopi/`，所有 worktree 共享；
 * 无 git 时回退到 `.todopi/.cache/`。
 *
 * git rev-parse --git-common-dir 返回的是**相对路径**（仓库根 `.git`，
 * 子目录 `../.git`），必须相对仓库根解析成绝对路径——实测过，直接当路径用会错。
 */
export function lockPathFor(ledger: Ledger): string {
  const common = gitCommonDir(ledger.root);
  return common === null
    ? join(ledger.dir, ".cache", "lock")
    : join(common, "todopi", "lock");
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
export function createTask(ledger: Ledger, make: (ctx: CreateContext) => NewTask): TaskFile {
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
    const text = emitTask(task);
    writeFileAtomic(path, text);

    // 读回来确认写出的形状自己能解析——写入端与读取端的闭环，
    // 而不是相信发射器。
    const env = splitEnvelope(readFileSync(path, "utf8"));
    if (env === null) throw new Error(`The task just written at ${path} is not a valid envelope`);
    const parsed = parseFrontmatter(env.head);
    if (!parsed.ok) throw new Error(`The task just written at ${path} could not be parsed: ${parsed.error}`);
    return {
      path: join("tasks", `${task.id}.md`),
      idFromFilename: task.id,
      frontmatter: parsed.data,
      body: env.body,
      raw: text,
    };
  });
}
