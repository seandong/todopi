import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverLedger, assertWritable, isNewerVersion } from "../../src/format/discover.ts";
import { withLedgerLock } from "../../src/format/write.ts";
import { recordPrime, markCompacted, readLastPrime, takeCompacted } from "../../src/format/session.ts";
import { EXIT, CliError } from "../../src/exit.ts";

/** 断言抛出的是带指定退出码的 CliError。用 instanceof 收窄，不用 any。 */
const hasCode = (code: number) => (e: unknown) => e instanceof CliError && e.code === code;

function makeLedger(version = 1): string {
  const root = mkdtempSync(join(tmpdir(), "todopi-"));
  mkdirSync(join(root, ".todopi", "tasks"), { recursive: true });
  writeFileSync(join(root, ".todopi", "config.yml"), `version: ${version}\nid_prefix: tp\n`);
  return root;
}

test("从子目录向上找到 .todopi/", () => {
  const root = makeLedger();
  mkdirSync(join(root, "a", "b"), { recursive: true });
  const l = discoverLedger(join(root, "a", "b"));
  assert.equal(l.dir, join(l.root, ".todopi"));
  assert.equal(l.config.version, 1);
});

test("找不到时抛出退出码 1", () => {
  const empty = mkdtempSync(join(tmpdir(), "todopi-none-"));
  assert.throws(() => discoverLedger(empty), hasCode(EXIT.usage));
});

test("版本高于本实现：照样读得出来，写入口（assertWritable、withLedgerLock）退出 4 且不调用写（spec §9）", () => {
  const root = makeLedger(2);
  const l = discoverLedger(root);
  assert.equal(l.config.version, 2);
  assert.equal(isNewerVersion(l), true);
  assert.throws(() => assertWritable(l), (e: unknown) => e instanceof CliError && e.code === EXIT.unsupportedVersion && /format version 2.*up to 1/.test(e.message));
  let ran = false;
  assert.throws(() => withLedgerLock(l, () => { ran = true; }), hasCode(EXIT.unsupportedVersion));
  assert.equal(ran, false);
  // 当前版本：可写
  const v1 = discoverLedger(makeLedger(1));
  assert.equal(isNewerVersion(v1), false);
  assert.doesNotThrow(() => assertWritable(v1));
});

test("版本更高：prime 记录与压缩标记不写（会话状态也在账本目录旁），读起来就是没有", () => {
  const l = discoverLedger(makeLedger(2));
  recordPrime(l, { actor: "a" }, "2026-01-01T00:00:00Z");
  markCompacted(l, { actor: "a" });
  assert.equal(readLastPrime(l, { actor: "a" }), null);
  assert.equal(takeCompacted(l, { actor: "a" }), false);
});

test("版本更高：之前留下的压缩标记不被取走（取走 = 删文件，也是写）", () => {
  const root = makeLedger(1);
  markCompacted(discoverLedger(root), { actor: "a" });
  writeFileSync(join(root, ".todopi", "config.yml"), "version: 2\nid_prefix: tp\n");
  const l = discoverLedger(root);
  assert.equal(takeCompacted(l, { actor: "a" }), false);
  writeFileSync(join(root, ".todopi", "config.yml"), "version: 1\nid_prefix: tp\n");
  assert.equal(takeCompacted(discoverLedger(root), { actor: "a" }), true);
});

test("config.yml 的未知键被保留", () => {
  const root = makeLedger();
  writeFileSync(join(root, ".todopi", "config.yml"), "version: 1\nfuture_key: keep-me\n");
  const l = discoverLedger(root);
  assert.equal(l.config.raw["future_key"], "keep-me");
});
