import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockPathFor, createTask, type Validate } from "../../src/format/write.ts";

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
