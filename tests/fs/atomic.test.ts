import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../../src/fs/atomic.ts";

const dir = () => mkdtempSync(join(tmpdir(), "todopi-atomic-"));

test("写出新文件", () => {
  const d = dir();
  writeFileAtomic(join(d, "a.txt"), "hello");
  assert.equal(readFileSync(join(d, "a.txt"), "utf8"), "hello");
});

test("覆盖已有文件", () => {
  const d = dir();
  writeFileSync(join(d, "a.txt"), "old");
  writeFileAtomic(join(d, "a.txt"), "new");
  assert.equal(readFileSync(join(d, "a.txt"), "utf8"), "new");
});

test("不留下临时文件", () => {
  const d = dir();
  writeFileAtomic(join(d, "a.txt"), "x");
  assert.deepEqual(readdirSync(d), ["a.txt"]);
});

test("目标目录不存在时抛错，不静默创建", () => {
  const d = dir();
  assert.throws(() => writeFileAtomic(join(d, "nope", "a.txt"), "x"));
});

test("失败时不留下临时文件", () => {
  const d = dir();
  mkdirSync(join(d, "sub"));
  try { writeFileAtomic(join(d, "sub"), "x"); } catch { /* 目标是目录，rename 会失败 */ }
  assert.deepEqual(readdirSync(d), ["sub"]);
});
