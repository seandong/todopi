import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../../src/commands/doctor.ts";
import { renderText, renderJson } from "../../src/output/render/doctor.ts";

function ledger(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "todopi-"));
  mkdirSync(join(root, ".todopi", "tasks"), { recursive: true });
  writeFileSync(join(root, ".todopi", "config.yml"), "version: 1\n");
  for (const [n, c] of Object.entries(files)) writeFileSync(join(root, ".todopi", "tasks", n), c);
  return root;
}
const OK = '---\nid: "tp-a1b2c3"\ntitle: "T"\nstatus: "open"\ncreated: "2026-09-14T09:00:00Z"\nupdated: "2026-09-14T09:00:00Z"\n---\n';
const BAD = OK.replace('"tp-a1b2c3"', '"tp-999999"');

test("干净的账本 ok 为 true", () => {
  const r = runDoctor({ directory: ledger({ "tp-a1b2c3.md": OK }) });
  assert.equal(r.ok, true);
  assert.equal(r.scanned, 1);
  assert.deepEqual(r.findings, []);
});

test("有问题时 ok 为 false 且 finding 带 rule", () => {
  const r = runDoctor({ directory: ledger({ "tp-a1b2c3.md": BAD }) });
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.rule === "invariant-1"));
});

test("空账本是干净的", () => {
  const r = runDoctor({ directory: ledger({}) });
  assert.equal(r.ok, true);
  assert.equal(r.scanned, 0);
});

test("文本渲染包含路径与规则名", () => {
  const r = runDoctor({ directory: ledger({ "tp-a1b2c3.md": BAD }) });
  const text = renderText(r);
  assert.match(text, /tasks[/\\]tp-a1b2c3\.md/);
  assert.match(text, /invariant-1/);
});

test("JSON 渲染是合法 JSON 且结构稳定", () => {
  const r = runDoctor({ directory: ledger({ "tp-a1b2c3.md": BAD }) });
  const parsed = JSON.parse(renderJson(r)) as { ok: boolean; scanned: number; findings: unknown[] };
  assert.equal(parsed.ok, false);
  assert.equal(parsed.scanned, 1);
  assert.equal(Array.isArray(parsed.findings), true);
});
