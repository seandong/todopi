import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";

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
