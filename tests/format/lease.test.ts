import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  leaseDirFor, leasePaths, readHeartbeats,
  createLease, writeLease, readLease, touchLease, deleteLease,
} from "../../src/format/lease.ts";
import { lockPathFor } from "../../src/format/write.ts";
import { discoverLedger } from "../../src/format/discover.ts";
import { initLedger } from "../../src/format/init.ts";

function ledger(opts: { git?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "todopi-lease-"));
  if (opts.git) execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  initLedger(root, { prefix: "tp" });
  return discoverLedger(root);
}

function withLeases(files: Record<string, string>, opts: { git?: boolean } = {}) {
  const l = ledger(opts);
  const dir = leaseDirFor(l);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return l;
}

test("有 git 时租约目录在 git 公共目录下（spec §8）", () => {
  assert.match(leaseDirFor(ledger({ git: true })), /\.git[/\\]todopi[/\\]leases$/);
});

test("无 git 时回退到 .todopi/.cache/leases（spec §8）", () => {
  assert.match(leaseDirFor(ledger()), /\.todopi[/\\]\.cache[/\\]leases$/);
});

test("有 git 时锁就在租约目录里 —— 两者不能各自判断 git-ness", () => {
  // 第三方按规格实现会去 .git/todopi/leases/lock 取锁。若锁与租约目录的推导
  // 分别写一遍，某天改动一处就会让两边各锁各的，完全不互斥。
  const l = ledger({ git: true });
  assert.equal(lockPathFor(l), join(leaseDirFor(l), "lock"));
});

test("leasePaths 一次调用同时给出两条路径 —— 不能各问一次 git", () => {
  // 分两次调用曾经存在过：第一次判断出在 git 里、第二次若瞬时失败，
  // 锁就会落到 .cache/leases/lock，恰好破坏「共用同一次 git-ness 判断」这个前提。
  for (const git of [true, false]) {
    const l = ledger({ git });
    const p = leasePaths(l);
    assert.equal(p.leaseDir, leaseDirFor(l));
    assert.equal(p.lockPath, lockPathFor(l));
  }
});

test("无 git 时锁**不**在 leases/ 里 —— 规格本身是不对称的", () => {
  const l = ledger();
  assert.match(lockPathFor(l), /\.todopi[/\\]\.cache[/\\]lock$/);
  assert.notEqual(lockPathFor(l), join(leaseDirFor(l), "lock"));
});

test("目录不存在时返回空 Map，不抛错", () => {
  assert.equal(readHeartbeats(ledger()).size, 0);
});

test("读出 <id>.json 的 heartbeat_at", () => {
  const l = withLeases({
    "tp-a1b2c3.json": JSON.stringify({
      actor: "claude-code@mbp", claimed_at: "2026-09-14T09:00:00Z",
      heartbeat_at: "2026-09-14T10:00:00Z",
    }),
  });
  assert.equal(readHeartbeats(l).get("tp-a1b2c3"), Date.parse("2026-09-14T10:00:00Z"));
});

test("坏掉的租约文件被跳过，不影响其他的", () => {
  const l = withLeases({
    "tp-a1b2c3.json": "not json",
    "tp-000002.json": JSON.stringify({ heartbeat_at: "2026-09-14T10:00:00Z" }),
    "tp-000003.json": JSON.stringify({ heartbeat_at: "not a timestamp" }),
    "tp-000004.json": JSON.stringify({ actor: "x" }),
  });
  const hb = readHeartbeats(l);
  assert.equal(hb.has("tp-a1b2c3"), false, "解析不了的跳过");
  assert.equal(hb.has("tp-000003"), false, "时间戳无效的跳过");
  assert.equal(hb.has("tp-000004"), false, "没有 heartbeat_at 的跳过");
  assert.equal(hb.get("tp-000002"), Date.parse("2026-09-14T10:00:00Z"));
});

test("JSON 合法但不是对象的条目被跳过", () => {
  // JSON.parse 认 "null"、"3"、"[]"——取字段前必须先确认是对象，否则
  // null["heartbeat_at"] 会抛 TypeError，让 ls 整个挂掉。
  const l = withLeases({
    "tp-000001.json": "null", "tp-000002.json": "3",
    "tp-000003.json": '["2026-09-14T10:00:00Z"]', "tp-000004.json": '"a string"',
  });
  assert.equal(readHeartbeats(l).size, 0);
});

test("非 .json 与不合法 id 的条目被忽略", () => {
  const l = withLeases({
    "README.txt": "x", "lock": "x",
    "not-an-id.json": JSON.stringify({ heartbeat_at: "2026-09-14T10:00:00Z" }),
    ".json": JSON.stringify({ heartbeat_at: "2026-09-14T10:00:00Z" }),
  });
  assert.equal(readHeartbeats(l).size, 0);
});

test("后缀恰好 5 个字符的同名文件不会被当成租约", () => {
  // spec §8 明说租约目录还要放别的本机运行时状态（如每个 session 上次注入
  // 上下文的时刻），所以这个目录里**一定**会有非租约文件。
  // "tp-000001.yaml" 去掉末尾 5 个字符恰好是合法 id——只靠 id 形状挡不住。
  const l = withLeases({
    "tp-000001.yaml": JSON.stringify({ heartbeat_at: "2026-09-14T10:00:00Z" }),
    "tp-000002.jsonc": JSON.stringify({ heartbeat_at: "2026-09-14T10:00:00Z" }),
  });
  assert.equal(readHeartbeats(l).size, 0);
});

test("多个租约同时读出", () => {
  const l = withLeases({
    "tp-000001.json": JSON.stringify({ heartbeat_at: "2026-09-14T10:00:00Z" }),
    "tp-000002.json": JSON.stringify({ heartbeat_at: "2026-09-14T11:00:00Z" }),
  });
  const hb = readHeartbeats(l);
  assert.equal(hb.size, 2);
  assert.equal(hb.get("tp-000002"), Date.parse("2026-09-14T11:00:00Z"));
});

// ---- 写入端（F05 Task 2）----

const T0 = "2026-09-14T09:00:00Z";
const T1 = "2026-09-14T10:00:00Z";
const lease = (actor: string, at: string) => ({ actor, claimed_at: at, heartbeat_at: at });
const rawLease = (l: ReturnType<typeof ledger>, id: string) =>
  JSON.parse(readFileSync(join(leaseDirFor(l), `${id}.json`), "utf8")) as Record<string, unknown>;

test("createLease 用 O_EXCL：第二次返回 false，且不覆盖第一次的内容", () => {
  const l = ledger();
  assert.equal(createLease(l, "tp-000001", lease("a@h", T0)), true);
  assert.equal(createLease(l, "tp-000001", lease("b@h", T1)), false);
  assert.equal(readLease(l, "tp-000001")?.actor, "a@h", "第二次不得覆盖");
});

test("三个字段都要写 —— 按规格实现的第三方读者会拒绝缺字段的租约", () => {
  const l = ledger();
  createLease(l, "tp-000001", lease("a@h", T0));
  assert.deepEqual(Object.keys(rawLease(l, "tp-000001")).sort(), ["actor", "claimed_at", "heartbeat_at"]);
});

test("租约目录不存在时 createLease 会建出来", () => {
  // 新克隆的仓库还没有 .git/todopi/，第一次 claim 不该因此失败。
  const l = ledger();
  assert.equal(existsSync(leaseDirFor(l)), false, "前提：目录本来不存在");
  assert.equal(createLease(l, "tp-000001", lease("a@h", T0)), true);
});

test("writeLease 覆盖既有租约（--steal 与重新认领要用）", () => {
  const l = ledger();
  createLease(l, "tp-000001", lease("a@h", T0));
  writeLease(l, "tp-000001", lease("b@h", T1));
  assert.equal(readLease(l, "tp-000001")?.actor, "b@h");
  assert.equal(readLease(l, "tp-000001")?.claimed_at, T1);
});

test("touchLease 只动 heartbeat_at，actor 与 claimed_at 不变（FR-C3）", () => {
  const l = ledger();
  createLease(l, "tp-000001", lease("a@h", T0));
  touchLease(l, "tp-000001", T1);
  const after = readLease(l, "tp-000001");
  assert.equal(after?.heartbeat_at, T1);
  assert.equal(after?.claimed_at, T0, "认领时刻不是心跳时刻");
  assert.equal(after?.actor, "a@h");
});

test("touchLease 对不存在的租约是空操作，不抛错也不凭空造一个", () => {
  // 持有者写入时刷心跳（FR-C3），但租约可能已被 doctor --fix 清掉。
  // 那时凭空造一个租约，等于让一次普通写入重新获得了它并不持有的独占。
  const l = ledger();
  assert.doesNotThrow(() => touchLease(l, "tp-000001", T1));
  assert.equal(readLease(l, "tp-000001"), null);
});

test("deleteLease 对不存在的租约不抛错", () => {
  // SIGKILL 之后租约可能已经没了，而 release 仍要把任务文件改回 open。
  // 这里抛错会让一个本该成功的 release 失败，把用户锁死在只能手改文件的状态。
  const l = ledger();
  assert.doesNotThrow(() => deleteLease(l, "tp-000001"));
  createLease(l, "tp-000001", lease("a@h", T0));
  deleteLease(l, "tp-000001");
  assert.equal(readLease(l, "tp-000001"), null);
});

test("readLease 对坏掉的租约返回 null，不抛错", () => {
  const l = ledger();
  mkdirSync(leaseDirFor(l), { recursive: true });
  writeFileSync(join(leaseDirFor(l), "tp-000001.json"), "not json");
  assert.equal(readLease(l, "tp-000001"), null);
});

test("写进去的租约，readHeartbeats 读得出来 —— 写入端与读取端必须对得上", () => {
  const l = ledger();
  createLease(l, "tp-000001", lease("a@h", T0));
  assert.equal(readHeartbeats(l).get("tp-000001"), Date.parse(T0));
});

test("createLease 只把 EEXIST 当成「已有人持有」，别的错误照抛", () => {
  // 把 EACCES 也报成 false，claim 会说「别人占着这个任务」，而真相是磁盘只读。
  // 对着屏幕的人能看出不对，agent 不能——它只会去认领下一个任务，
  // 然后在同一块磁盘上再失败一次。
  const l = ledger();
  const dir = leaseDirFor(l);
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, 0o500);
  try {
    let threw: unknown = null;
    let result: boolean | null = null;
    try { result = createLease(l, "tp-000001", lease("a@h", T0)); } catch (e) { threw = e; }
    if (result === true) return;            // 以 root 运行时写得进去，这条用例不适用
    assert.equal(result, null, "不得把权限错误报成「已有人持有」");
    assert.equal((threw as NodeJS.ErrnoException).code, "EACCES");
  } finally {
    chmodSync(dir, 0o700);                  // 还原，否则临时目录删不掉
  }
});
