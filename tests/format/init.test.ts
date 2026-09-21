import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initLedger, renderConfig } from "../../src/format/init.ts";
import { discoverLedger } from "../../src/format/discover.ts";

const dir = () => mkdtempSync(join(tmpdir(), "todopi-init-"));

test("建出 spec §2 要求的三样东西", () => {
  const d = dir();
  initLedger(d, { prefix: "tp" });
  assert.ok(existsSync(join(d, ".todopi", "config.yml")));
  assert.ok(existsSync(join(d, ".todopi", "tasks")));
  assert.ok(existsSync(join(d, ".todopi", ".gitignore")));
});

test(".gitignore 含 .cache/（spec §2 明文）", () => {
  const d = dir();
  initLedger(d, { prefix: "tp" });
  assert.match(readFileSync(join(d, ".todopi", ".gitignore"), "utf8"), /^\.cache\/$/m);
});

test("config.yml 能被 F01 的 discoverLedger 读回", () => {
  const d = dir();
  initLedger(d, { prefix: "xyz" });
  const l = discoverLedger(d);
  assert.equal(l.config.version, 1);
  assert.equal(l.config.id_prefix, "xyz");
});

test("config.yml 的键按 spec §3 的顺序", () => {
  const keys = renderConfig("tp").split("\n").filter((l) => l.includes(":")).map((l) => l.split(":")[0]);
  assert.deepEqual(keys, ["version", "id_prefix", "lease_hours", "verify_timeout_seconds"]);
});

test("重复运行不改动已有文件", () => {
  const d = dir();
  initLedger(d, { prefix: "tp" });
  writeFileSync(join(d, ".todopi", "config.yml"), "version: 1\nlease_hours: 8\n");
  const second = initLedger(d, { prefix: "tp" });
  assert.equal(readFileSync(join(d, ".todopi", "config.yml"), "utf8"), "version: 1\nlease_hours: 8\n");
  assert.ok(second.kept.some((p) => p.endsWith("config.yml")));
  assert.equal(second.created.length, 0);
});

test("缺什么补什么：只有 config.yml 时补上 tasks/ 与 .gitignore", () => {
  const d = dir();
  mkdirSync(join(d, ".todopi"), { recursive: true });
  writeFileSync(join(d, ".todopi", "config.yml"), "version: 1\n");
  const r = initLedger(d, { prefix: "tp" });
  assert.ok(existsSync(join(d, ".todopi", "tasks")));
  assert.ok(r.created.some((p) => p.endsWith(".gitignore")));
  assert.ok(r.kept.some((p) => p.endsWith("config.yml")));
});

test("新建的账本能被读回且版本为 1", () => {
  const d = dir();
  initLedger(d, { prefix: "tp" });
  assert.equal(discoverLedger(d).config.version, 1);
});
