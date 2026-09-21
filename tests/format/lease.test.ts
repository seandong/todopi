import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { leaseDirFor, readHeartbeats } from "../../src/format/lease.ts";
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
