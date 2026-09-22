import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockPathFor, createTask, updateTask, type Validate } from "../../src/format/write.ts";
import { readTasks } from "../../src/format/read.ts";
import { EXIT, CliError } from "../../src/exit.ts";

/** 本文件测的是写入机制本身，不是校验规则——校验有 add 的用例覆盖。 */
const noValidation: Validate = () => null;
import { discoverLedger } from "../../src/format/discover.ts";
import { initLedger } from "../../src/format/init.ts";

function ledger(opts: { git?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "todopi-write-"));
  // 必须是真的 git init——一个空的 .git 目录不是合法仓库，
  // git rev-parse 会报 "not a git repository"，于是回退到 .cache/ 分支。
  if (opts.git) {
    execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  }
  initLedger(root, { prefix: "tp" });
  return discoverLedger(root);
}

test("有 git 时锁在 git 公共目录下（spec §8）", () => {
  const l = ledger({ git: true });
  // 路径必须与 spec §8 逐字一致——第三方按规格实现会去这里取锁。
  assert.match(lockPathFor(l), /\.git[/\\]todopi[/\\]leases[/\\]lock$/);
});

test("无 git 时锁回退到 .todopi/.cache/（spec §8）", () => {
  const l = ledger();
  assert.match(lockPathFor(l), /\.todopi[/\\]\.cache[/\\]lock$/);
});

test("createTask 写出文件，文件名是 id.md", () => {
  const l = ledger();
  const t = createTask(l, (ctx) => ({
    id: ctx.newId(), title: "T", status: "open", rank: ctx.nextRank(),
    created: ctx.now, updated: ctx.now, log: [`${ctx.now} sean created`],
  }), noValidation);
  assert.ok(existsSync(join(l.dir, "tasks", `${t.idFromFilename}.md`)));
});

test("连续创建的 rank 字典序递增", () => {
  const l = ledger();
  const ranks: string[] = [];
  for (let i = 0; i < 4; i++) {
    createTask(l, (ctx) => {
      const r = ctx.nextRank();
      ranks.push(r);
      return { id: ctx.newId(), title: `T${i}`, status: "open", rank: r,
        created: ctx.now, updated: ctx.now, log: [`${ctx.now} sean created`] };
    }, noValidation);
  }
  assert.deepEqual(ranks, [...ranks].sort(), "连续创建的 rank 必须递增");
  assert.equal(new Set(ranks).size, 4, "rank 不得重复");
});

test("id 碰撞时重新生成 —— ctx.newId 不返回已存在的 id", () => {
  const l = ledger();
  const first = createTask(l, (ctx) => ({
    id: ctx.newId(), title: "A", status: "open", rank: ctx.nextRank(),
    created: ctx.now, updated: ctx.now, log: [`${ctx.now} sean created`],
  }), noValidation);
  const taken = first.idFromFilename.split("-")[1]!;
  let calls = 0;
  const second = createTask(l, (ctx) => ({
    id: ctx.newId(() => (calls++ === 0 ? taken : "zzzzzz")),
    title: "B", status: "open", rank: ctx.nextRank(),
    created: ctx.now, updated: ctx.now, log: [`${ctx.now} sean created`],
  }), noValidation);
  assert.notEqual(second.idFromFilename, first.idFromFilename);
  assert.equal(readdirSync(join(l.dir, "tasks")).length, 2, "不得覆盖已有任务");
});

test("写入期间持锁 —— 锁文件在 fn 执行时存在，结束后消失", () => {
  const l = ledger();
  const lock = lockPathFor(l);
  let seenDuringWrite = false;
  createTask(l, (ctx) => {
    seenDuringWrite = existsSync(lock);
    return { id: ctx.newId(), title: "T", status: "open", rank: ctx.nextRank(),
      created: ctx.now, updated: ctx.now, log: [`${ctx.now} sean created`] };
  }, noValidation);
  assert.ok(seenDuringWrite, "临界区内必须持锁");
  assert.ok(!existsSync(lock), "结束后必须释放");
});

test("now 是 spec 要求的 UTC 秒级时间戳", () => {
  const l = ledger();
  let now = "";
  createTask(l, (ctx) => {
    now = ctx.now;
    return { id: ctx.newId(), title: "T", status: "open", rank: ctx.nextRank(),
      created: ctx.now, updated: ctx.now, log: [`${ctx.now} sean created`] };
  }, noValidation);
  assert.match(now, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test("同一次创建内重复调用 nextRank 返回同一个值", () => {
  // 调用方可能在构造任务对象时多次取 rank（比如先算再用）。每次都分配一个新的，
  // 会白白消耗 rank 空间，更糟的是让「写进文件的那个」与「以为分配的那个」不同。
  const l = ledger();
  let a = "", b = "";
  createTask(l, (ctx) => {
    a = ctx.nextRank();
    b = ctx.nextRank();
    return { id: ctx.newId(), title: "T", status: "open", rank: a,
      created: ctx.now, updated: ctx.now, log: [`${ctx.now} sean created`] };
  }, noValidation);
  assert.equal(a, b, "同一次创建内 nextRank 必须幂等");
});

test("校验器由调用方注入，拒绝时不写文件", () => {
  // Codex 复审指出：createTask 若只做单文件校验，绕过 add 层直接调用时可以写出
  // parent 指向自身的自环任务，随后 doctor 报 invariant-5。校验器现在由调用方
  // 传入，add 传的那个含图校验（见 src/commands/add.ts）。
  const l = ledger();
  assert.throws(
    () => createTask(
      l,
      (ctx) => ({ id: ctx.newId(), title: "T", status: "open", rank: ctx.nextRank(),
        created: ctx.now, updated: ctx.now, log: [`${ctx.now} sean created`] }),
      () => "invariant-5: self-cycle",
    ),
    /doctor/i,
  );
  assert.deepEqual(readdirSync(join(l.dir, "tasks")), [], "被拒绝的创建不得留下文件");
});

test("校验器拿得到已有任务集合 —— 图校验需要它", () => {
  const l = ledger();
  createTask(l, (ctx) => ({ id: ctx.newId(), title: "A", status: "open", rank: ctx.nextRank(),
    created: ctx.now, updated: ctx.now, log: [`${ctx.now} sean created`] }), noValidation);
  let sawExisting = -1;
  createTask(l, (ctx) => ({ id: ctx.newId(), title: "B", status: "open", rank: ctx.nextRank(),
    created: ctx.now, updated: ctx.now, log: [`${ctx.now} sean created`] }),
    (_candidate, existing) => { sawExisting = existing.length; return null; });
  assert.equal(sawExisting, 1, "校验器必须看到账本里已有的任务");
});

// ---- updateTask（F05 Task 1）----

function seed(l: ReturnType<typeof ledger>, extra: Record<string, unknown> = {}): string {
  const t = createTask(l, (ctx) => ({
    id: ctx.newId(), title: "seed", status: "open", rank: ctx.nextRank(),
    created: ctx.now, updated: ctx.now, log: [`${ctx.now} tester created`], ...extra,
  }), noValidation);
  return t.idFromFilename;
}

test("updateTask 改字段、刷新 updated、追加 Log", () => {
  const l = ledger();
  const id = seed(l);
  const before = readTasks(l).find((t) => t.idFromFilename === id)!;

  const after = updateTask(l, id, (t, now) => ({
    frontmatter: { ...t.frontmatter, status: "in_progress", assignee: "tester@host" },
    appendLog: `${now} tester@host claimed`,
  }), noValidation);

  assert.equal(after.frontmatter["status"], "in_progress");
  assert.equal(after.frontmatter["assignee"], "tester@host");
  assert.ok(String(after.frontmatter["updated"]) >= String(before.frontmatter["updated"]),
    "spec §6.3：每次写入都要刷新 updated");
  assert.match(after.body, /claimed$/m);
});

test("updated 由 updateTask 统一刷新，调用方给的会被覆盖", () => {
  // 调用方忘了刷新（或故意写了旧值）都不该让心跳停摆——§7.3 的跨机 stale
  // 判定靠的就是 updated。
  const l = ledger();
  const id = seed(l);
  const after = updateTask(l, id, (t) => ({
    frontmatter: { ...t.frontmatter, updated: "2020-01-01T00:00:00Z" },
  }), noValidation);
  assert.notEqual(after.frontmatter["updated"], "2020-01-01T00:00:00Z");
});

test("不认识的键与 external 原样保留（spec §5.2 字段 11）", () => {
  // 这条是 F05 要抽 updateTask 的直接理由：带 external 的任务原先一改写就抛错。
  // NewTask 没有 external 字段（add 不产生它），所以手工补进文件里——
  // 真实来源是导入器与第三方工具，它们写的就是这种文件。
  const l = ledger();
  const id = seed(l);
  const p = join(l.dir, "tasks", `${id}.md`);
  writeFileSync(p, readFileSync(p, "utf8").replace(
    /^status: "open"$/m,
    'status: "open"\nexternal:\n  linear:\n    id: "ENG-1"\n    url: "https://x"'));
  const after = updateTask(l, id, (t) => ({
    frontmatter: { ...t.frontmatter, status: "in_progress", assignee: "a@h" },
  }), noValidation);
  assert.deepEqual(after.frontmatter["external"], { linear: { id: "ENG-1", url: "https://x" } });
});

test("正文默认一个字节都不动", () => {
  const l = ledger();
  const id = seed(l);
  const before = readTasks(l).find((t) => t.idFromFilename === id)!.body;
  const after = updateTask(l, id, (t) => ({ frontmatter: { ...t.frontmatter, title: "changed" } }), noValidation);
  assert.equal(after.body, before);
});

test("Log 行追加在小节末尾，最新的在最后", () => {
  const l = ledger();
  const id = seed(l);
  updateTask(l, id, (_t, now) => ({ frontmatter: { ..._t.frontmatter }, appendLog: `${now} a claimed` }), noValidation);
  const after = updateTask(l, id, (t, now) => ({ frontmatter: { ...t.frontmatter }, appendLog: `${now} b released` }), noValidation);
  const logs = after.body.split("\n").filter((x) => x.startsWith("- 2"));
  assert.equal(logs.length, 3, "created + claimed + released");
  assert.match(logs.at(-1)!, /released$/);
});

test("没有 ## Log 小节时建一个（手写的文件不一定有）", () => {
  const l = ledger();
  const id = seed(l);
  const p = join(l.dir, "tasks", `${id}.md`);
  const raw = readFileSync(p, "utf8");
  writeFileSync(p, raw.slice(0, raw.indexOf("## Log")).trimEnd() + "\n");
  const after = updateTask(l, id, (t, now) => ({ frontmatter: { ...t.frontmatter }, appendLog: `${now} x noted` }), noValidation);
  assert.match(after.body, /## Log/);
  assert.match(after.body, /noted$/m);
});

test("id 不存在时报用法错误，并指向 ls", () => {
  const l = ledger();
  assert.throws(() => updateTask(l, "tp-zzzzzz", (t) => ({ frontmatter: t.frontmatter }), noValidation),
    (e: unknown) => e instanceof CliError && e.code === EXIT.usage && /todopi ls/.test(e.message));
});

test("校验在写入之前 —— 被拒绝时磁盘上的文件一个字节都没变", () => {
  // F03 第二轮评审的结论：校验放在写之后，失败时磁盘上已经留下了损坏文件。
  const l = ledger();
  const id = seed(l);
  const p = join(l.dir, "tasks", `${id}.md`);
  const before = readFileSync(p, "utf8");
  const reject: Validate = () => "nope";
  assert.throws(() => updateTask(l, id, (t) => ({
    frontmatter: { ...t.frontmatter, title: "changed" },
  }), reject));
  assert.equal(readFileSync(p, "utf8"), before);
});

test("校验器拿到的 existing 不含被改的那个任务自己", () => {
  // 否则「id 不得与已有任务重复」这类图校验会把自己判成冲突。
  const l = ledger();
  const id = seed(l);
  let seen: string[] = [];
  updateTask(l, id, (t) => ({ frontmatter: { ...t.frontmatter } }), (_c, existing) => {
    seen = existing.map((x) => x.idFromFilename);
    return null;
  });
  assert.ok(!seen.includes(id), "被改的任务不该出现在 existing 里");
});

test("解析不了的任务拒绝改写，并指向 doctor", () => {
  const l = ledger();
  const id = seed(l);
  writeFileSync(join(l.dir, "tasks", `${id}.md`), "no envelope here\n");
  assert.throws(() => updateTask(l, id, (t) => ({ frontmatter: t.frontmatter }), noValidation),
    (e: unknown) => e instanceof CliError && /doctor/.test(e.message));
});

test("Log 后面还有别的小节时，新条目紧跟最后一条，不越过空行贴到下个标题上", () => {
  // spec §5.3 的规范顺序里 Log 在最后，但「其他内容 MUST 被保留」——手写的
  // 文件可以在 Log 之后还有小节。插入位置若取到小节末尾的空行之后，
  // 新条目会紧贴下一个标题（`- item` 与 `## Notes` 之间没有空行）。
  const l = ledger();
  const id = seed(l);
  const p = join(l.dir, "tasks", `${id}.md`);
  writeFileSync(p, readFileSync(p, "utf8").trimEnd() + "\n\n## Notes\n\nkeep me\n");

  const after = updateTask(l, id, (t, now) => ({
    frontmatter: { ...t.frontmatter }, appendLog: `${now} x noted`,
  }), noValidation);

  const lines = after.body.split("\n");
  const at = lines.findIndex((x) => x.includes("noted"));
  assert.ok(at > 0, "新条目要在正文里");
  assert.match(lines[at - 1]!, /^- .*created$/, "新条目紧跟上一条日志");
  assert.match(after.body, /keep me/, "后面的小节要原样保留");
  assert.ok(after.body.includes("\n\n## Notes"), "与下个标题之间仍要有空行");
});
