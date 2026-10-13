import { test } from "node:test";
import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.ts";
import { runAdd } from "../src/commands/add.ts";
import { runClaim } from "../src/commands/claim.ts";

function runCli(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", ["src/cli.ts", ...args], { encoding: "utf8" });
    return { stdout, status: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (err.stdout ?? "") + (err.stderr ?? ""), status: err.status ?? -1 };
  }
}

test("--version 打印版本号并退出 0", () => {
  const r = runCli(["--version"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^\d+\.\d+\.\d+/m);
});

test("未知子命令退出 1（FR-Q2：用法错误）", () => {
  const r = runCli(["nosuchcommand"]);
  assert.equal(r.status, 1);
});

test("note 的待验证模式可从 CLI 写入；冲突参数在写入前拒绝", () => {
  const d = mkdtempSync(join(tmpdir(), "todopi-cli-pending-"));
  runInit({ directory: d, prefix: "tp" });
  const actor = "me@host";
  const id = runAdd({ directory: d, title: "T", actor }).id;
  runClaim({ directory: d, id, actor });
  const file = join(d, ".todopi", "tasks", `${id}.md`);
  const invoke = (...args: string[]) => spawnSync(process.execPath,
    [join(process.cwd(), "src", "cli.ts"), "-C", d, "--as", actor, "note", id, ...args], { encoding: "utf8" });
  const before = readFileSync(file, "utf8");
  for (const args of [[], ["--verify-pending", "run test", "ordinary text"],
    ["--verify-pending", "run test", "--clear-verify-pending"],
    ["--clear-verify-pending", "ordinary text"]]) {
    const result = invoke(...args);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(readFileSync(file, "utf8"), before);
  }
  assert.equal(invoke("--verify-pending", "run test").status, 0);
  assert.match(readFileSync(file, "utf8"), / verify_pending: run test/);
  assert.equal(invoke("--clear-verify-pending").status, 0);
  assert.match(readFileSync(file, "utf8"), / verify_cleared/);
});
