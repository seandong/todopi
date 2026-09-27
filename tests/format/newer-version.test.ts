// F25：格式版本更高的账本只读（spec §9）。每一个落盘的入口都要挡住——不只锁：createTask 曾经绕过 withLedgerLock 直接拿锁，
// 于是 `add` 在 version 2 的账本上照样建了任务（e2e 实测）。
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverLedger } from "../../src/format/discover.ts";
import { readTasks } from "../../src/format/read.ts";
import { createTask, createTaskUnlocked, prepareUpdate, withLedgerLock, writeNormalized } from "../../src/format/write.ts";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { runHandoff } from "../../src/commands/handoff.ts";
import { EXIT, CliError } from "../../src/exit.ts";

const ME = "tester";
const refused = (e: unknown) => e instanceof CliError && e.code === EXIT.unsupportedVersion;

function newerLedger() {
  const d = mkdtempSync(join(tmpdir(), "todopi-newer-"));
  runInit({ directory: d, prefix: "tp" });
  const { id } = runAdd({ directory: d, title: "T", actor: ME });
  runClaim({ directory: d, id, actor: ME });
  const cfg = join(d, ".todopi", "config.yml");
  writeFileSync(cfg, readFileSync(cfg, "utf8").replace(/^version: 1$/m, "version: 2"));
  const snap = () => readdirSync(join(d, ".todopi", "tasks")).map((f) => readFileSync(join(d, ".todopi", "tasks", f), "utf8")).join("\0");
  return { d, id, ledger: discoverLedger(d), snap };
}

const make = (ctx: { newId: () => string; nextRank: () => string; now: string }) =>
  ({ id: ctx.newId(), title: "x", status: "open" as const, rank: ctx.nextRank(), created: ctx.now, updated: ctx.now, log: [`${ctx.now} ${ME} created`] });

test("createTask / createTaskUnlocked：退出 4，不建文件", () => {
  const { ledger, snap } = newerLedger();
  const before = snap();
  assert.throws(() => createTask(ledger, make, () => null), refused);
  assert.throws(() => createTaskUnlocked(ledger, make, () => null), refused);
  assert.equal(snap(), before);
});

test("prepareUpdate 的 commit、writeNormalized：退出 4，文件不变", () => {
  const { ledger, id, snap } = newerLedger();
  const before = snap();
  const tasks = readTasks(ledger);
  const t = tasks.find((x) => x.idFromFilename === id)!;
  const p = prepareUpdate(ledger, tasks, id, { frontmatter: { ...t.frontmatter, title: "changed" } }, () => null, "2026-01-01T00:00:00Z");
  assert.throws(() => p.commit(), refused);
  assert.throws(() => writeNormalized(ledger, t, "garbage"), refused);
  assert.equal(snap(), before);
});

test("handoff：整条命令退出 4（不给一份没记上的交接报告）", () => {
  const { d, snap } = newerLedger();
  const before = snap();
  assert.throws(() => runHandoff({ directory: d, actor: ME }), refused);
  assert.equal(snap(), before);
});

test("闸门看的是磁盘上此刻的版本，不是发现账本时的快照", () => {
  const d = mkdtempSync(join(tmpdir(), "todopi-race-"));
  runInit({ directory: d, prefix: "tp" });
  const ledger = discoverLedger(d);
  const cfg = join(d, ".todopi", "config.yml");
  writeFileSync(cfg, readFileSync(cfg, "utf8").replace(/^version: 1$/m, "version: 2"));
  assert.equal(ledger.config.version, 1);
  let ran = false;
  assert.throws(() => withLedgerLock(ledger, () => { ran = true; }), refused);
  assert.equal(ran, false);
  assert.throws(() => createTaskUnlocked(ledger, make, () => null), refused);
});
