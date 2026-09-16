import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverLedger } from "../../src/format/discover.ts";
import { readTasks } from "../../src/format/read.ts";

function ledgerWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "todopi-"));
  mkdirSync(join(root, ".todopi", "tasks"), { recursive: true });
  writeFileSync(join(root, ".todopi", "config.yml"), "version: 1\n");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, ".todopi", "tasks", name), content);
  }
  return root;
}

const MINIMAL = '---\nid: "tp-a1b2c3"\ntitle: "T"\nstatus: "open"\ncreated: "2026-09-14T09:00:00Z"\nupdated: "2026-09-14T09:00:00Z"\n---\n';

test("读出任务并从文件名取 id", () => {
  const root = ledgerWith({ "tp-a1b2c3.md": MINIMAL });
  const tasks = readTasks(discoverLedger(root));
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]!.idFromFilename, "tp-a1b2c3");
  assert.equal(tasks[0]!.frontmatter["title"], "T");
});

test("非 .md 与不合法 id 的文件被忽略", () => {
  const root = ledgerWith({ "tp-a1b2c3.md": MINIMAL, "README.txt": "x", "NOTES.md": "y" });
  assert.equal(readTasks(discoverLedger(root)).length, 1);
});

test("解析失败的文件仍进结果，带 parseError", () => {
  const root = ledgerWith({ "tp-a1b2c3.md": "no envelope here\n" });
  const tasks = readTasks(discoverLedger(root));
  assert.equal(tasks.length, 1);
  assert.ok(tasks[0]!.parseError);
});
