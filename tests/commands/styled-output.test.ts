import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_SIGNALS } from "../../src/domain/actor.ts";

/**
 * 真跑 CLI（tp-rk6o8q）：FORCE_COLOR 在，也只有人在终端里看的那种输出才带转义；--json、钩子、agent 在场、NO_COLOR 一律纯文本。
 * 测试本身常在某个 agent 里跑（环境里有 CLAUDECODE 之类），所以每次都从干净的环境起，只加这一条要测的变量。
 */
const CLI = join(process.cwd(), "src", "cli.ts");
const ESC = "\x1b";
const clean = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k === "TODOPI_AGENT" || k === "NO_COLOR" || k === "FORCE_COLOR" || k === "TERM") continue;
    if (AGENT_SIGNALS.some((s) => s.env === k)) continue;
    env[k] = v;
  }
  return env;
};
const run = (args: string[], extra: Record<string, string>, input?: string) => {
  const d = mkdtempSync(join(tmpdir(), "todopi-style-"));
  spawnSync("git", ["init", "-q"], { cwd: d });
  return spawnSync(process.execPath, [CLI, "-C", d, ...args], { encoding: "utf8", env: { ...clean(), ...extra }, input: input ?? "" });
};
const initThen = (args: string[], extra: Record<string, string>, input?: string) => {
  const d = mkdtempSync(join(tmpdir(), "todopi-style-"));
  spawnSync("git", ["init", "-q"], { cwd: d });
  spawnSync(process.execPath, [CLI, "-C", d, "init"], { env: clean() });
  return spawnSync(process.execPath, [CLI, "-C", d, ...args], { encoding: "utf8", env: { ...clean(), ...extra }, input: input ?? "" });
};

test("只给 FORCE_COLOR：init 与 setup 的输出带样式", () => {
  assert.ok(run(["init"], { FORCE_COLOR: "1" }).stdout.includes(ESC));
  assert.ok(initThen(["setup", "claude"], { FORCE_COLOR: "1" }).stdout.includes(ESC));
});

test("FORCE_COLOR 在，--json 仍是纯 JSON", () => {
  const r = run(["--json", "init"], { FORCE_COLOR: "1" });
  assert.ok(!r.stdout.includes(ESC));
  JSON.parse(r.stdout);
});

test("FORCE_COLOR 在，钩子里的 prime 没有转义", () => {
  const r = initThen(["prime", "--hook"], { FORCE_COLOR: "1" }, "{}");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes(ESC));
});

test("FORCE_COLOR 在，有 agent 在场（任何一家的环境信号、TODOPI_AGENT、--agent）：纯文本", () => {
  for (const s of AGENT_SIGNALS) {
    const r = run(["init"], { FORCE_COLOR: "1", [s.env]: s.value ?? "x" });
    assert.ok(!r.stdout.includes(ESC), s.env);
  }
  // 嵌套：两家的信号都在（身份推断此时不猜，上色也不能因此放开）
  assert.ok(!run(["init"], { FORCE_COLOR: "1", CLAUDECODE: "1", CODEX_THREAD_ID: "t" }).stdout.includes(ESC));
  assert.ok(!run(["init"], { FORCE_COLOR: "1", TODOPI_AGENT: "codex" }).stdout.includes(ESC));
  assert.ok(!run(["--agent", "codex", "init"], { FORCE_COLOR: "1" }).stdout.includes(ESC));
});

test("NO_COLOR、TERM=dumb 压过 FORCE_COLOR", () => {
  assert.ok(!run(["init"], { FORCE_COLOR: "1", NO_COLOR: "" }).stdout.includes(ESC));
  assert.ok(!run(["init"], { FORCE_COLOR: "1", TERM: "dumb" }).stdout.includes(ESC));
});

test("什么都不给（stdout 是管道）：纯文本", () => {
  assert.ok(!run(["init"], {}).stdout.includes(ESC));
});
