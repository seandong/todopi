import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverLedger } from "../../src/format/discover.ts";
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

test("版本高于本实现时抛出退出码 4", () => {
  const root = makeLedger(2);
  assert.throws(() => discoverLedger(root), hasCode(EXIT.unsupportedVersion));
});

test("config.yml 的未知键被保留", () => {
  const root = makeLedger();
  writeFileSync(join(root, ".todopi", "config.yml"), "version: 1\nfuture_key: keep-me\n");
  const l = discoverLedger(root);
  assert.equal(l.config.raw["future_key"], "keep-me");
});
