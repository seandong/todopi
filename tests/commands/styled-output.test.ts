import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_SIGNALS } from "../../src/domain/actor.ts";

/**
 * 真跑 CLI（tp-rk6o8q）：FORCE_COLOR 在，也只有人在终端里看的那种输出才带转义；--json、钩子、agent 在场、NO_COLOR 一律纯文本。
 * 测试本身常在某个 agent 里跑（环境里有 CLAUDECODE 之类），所以每次都从干净的环境起，只加这一条要测的变量。
 */
const CLI = join(process.cwd(), "src", "cli.ts");
const ESC = "\x1b";
// 信任清单写进临时目录（done --yes 会记下这个仓库）：测试不碰、也不依赖使用者的 ~/.config/todopi/trust（评审二轮）
const CONFIG = mkdtempSync(join(tmpdir(), "todopi-style-config-"));
const clean = (): Record<string, string> => {
  const env: Record<string, string> = { TODOPI_CONFIG_DIR: CONFIG };
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k === "TODOPI_AGENT" || k === "NO_COLOR" || k === "FORCE_COLOR" || k === "TERM" || k === "TODOPI_CONFIG_DIR") continue;
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

// 直接调真实 CLI 的帮助路径：已有命令的 styleFor 判定必须同样约束 Commander 的格式化。
test("终端帮助上色，去掉 ANSI 后与纯文本帮助完全一致", () => {
  for (const args of [["--help"], ["prime", "--help"], ["help", "prime"]]) {
    const plain = run(args, {});
    const colored = run(args, { FORCE_COLOR: "1" });
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(colored.status, 0, colored.stderr);
    assert.match(colored.stdout, /\x1b\[1mUsage:\x1b\[22m/);
    assert.match(colored.stdout, /\x1b\[36m(?:prime|--full|--help)/);
    assert.equal(colored.stdout.replace(/\x1b\[[0-9;]*m/g, ""), plain.stdout);
  }
});

test("Agent、JSON、NO_COLOR 和 dumb 终端下帮助保持纯文本", () => {
  const cases: [string[], Record<string, string>][] = [
    [["--help"], { FORCE_COLOR: "1", CLAUDECODE: "1" }],
    [["prime", "--help"], { FORCE_COLOR: "1", TODOPI_AGENT: "codex" }],
    [["--agent=codex", "--help"], { FORCE_COLOR: "1" }],
    [["prime", "--hook-json=cursor", "--help"], { FORCE_COLOR: "1" }],
    [["--json", "--help"], { FORCE_COLOR: "1" }],
    [["--help"], { FORCE_COLOR: "1", NO_COLOR: "" }],
    [["prime", "--help"], { FORCE_COLOR: "1", TERM: "dumb" }],
    [["--help"], {}],
  ];
  for (const [args, env] of cases) {
    const r = run(args, env);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes(ESC), `${args.join(" ")} ${JSON.stringify(env)}`);
  }
});

/**
 * 每个命令都跑一遍（tp-rk6o8q 的发布前提）：FORCE_COLOR 在，有 agent 在场或给了 --json 时，stdout 与 stderr 都不许有一个转义字节——
 * 这些输出会进 agent 的上下文（ARCH-027）。反过来只给 FORCE_COLOR 时要真的上色，证明这组测试分得出两种情形。
 */
function ledgerWithTasks(): { d: string; a: string; b: string } {
  const d = mkdtempSync(join(tmpdir(), "todopi-style-all-"));
  spawnSync("git", ["init", "-q"], { cwd: d });
  const cli = (...args: string[]) => spawnSync(process.execPath, [CLI, "-C", d, ...args], { encoding: "utf8", env: clean(), input: "" });
  cli("init");
  const a = cli("add", "First", "--verify", "false", "--ac", "it works").stdout.split(/\s/)[0]!;
  const b = cli("add", "Second").stdout.split(/\s/)[0]!;
  writeFileSync(join(d, "plan.md"), "- [ ] one\n- [ ] two\n");
  return { d, a, b };
}

// 每条命令与它在这个顺序下预期的退出码：done 的 verify 是 false，走门禁报告（退出 2）；show tp-nope 走错误出口（退出 1）
const COMMANDS = (d: string, a: string, b: string): [args: string[], code: number][] => [
  [["ls"], 0], [["ls", "--all"], 0], [["show", a], 0], [["show", a, "--tree"], 0], [["claim", a], 0], [["note", a, "hello"], 0],
  [["check", a, "1"], 0], [["edit", a, "--label", "ui"], 0], [["move", b, "--before", a], 0], [["dep", "add", b, "--on", a], 0],
  [["prime"], 0], [["prime", "--full"], 0], [["handoff", "--check"], 0], [["done", a, "--yes"], 2], [["release", a], 0],
  [["close", b, "--resolution", "wontfix"], 0], [["reopen", b], 0], [["doctor"], 0], [["doctor", "--fix"], 0],
  [["import", join(d, "plan.md")], 0], [["setup", "claude"], 0], [["add", "Third"], 0], [["show", "tp-nope"], 1],
];

test("所有命令：FORCE_COLOR 下 agent 在场或 --json，stdout 与 stderr 都没有转义（每种情形一个新账本，逐条核对退出码）", () => {
  for (const [label, extra, pre] of [["agent", { FORCE_COLOR: "1", CLAUDECODE: "1" }, []], ["json", { FORCE_COLOR: "1" }, ["--json"]]] as const) {
    // 每种情形一个新账本：同一个账本连跑两轮，第二轮的 claim 之类会走错误路径，测试就证明不了渲染分支受保护（评审 P2）
    const { d, a, b } = ledgerWithTasks();
    for (const [args, code] of COMMANDS(d, a, b)) {
      const r = spawnSync(process.execPath, [CLI, "-C", d, ...pre, ...args], { encoding: "utf8", env: { ...clean(), ...extra }, input: "" });
      const what = `${label}: todopi ${args.join(" ")}`;
      assert.equal(r.status, code, `${what}: exit ${r.status}; stderr ${r.stderr}`);
      if (code !== 1) assert.notEqual(r.stdout.trim(), "", `${what}: stdout 为空，渲染分支没跑到`);
      else assert.match(r.stderr, /^error: /, `${what}: 错误出口`);
      assert.ok(!r.stdout.includes(ESC), `${what} stdout`);
      assert.ok(!r.stderr.includes(ESC), `${what} stderr`);
    }
  }
});

test("错误消息里的控制字符（数据自带的 ESC）也被转义：agent 在场与 --json 的 stderr 都没有 ESC", () => {
  const { d } = ledgerWithTasks();
  for (const [extra, pre] of [[{ FORCE_COLOR: "1", CLAUDECODE: "1" }, []], [{ FORCE_COLOR: "1" }, ["--json"]]] as const) {
    const r = spawnSync(process.execPath, [CLI, "-C", d, ...pre, "show", "tp-abc\x1b[31m"], { encoding: "utf8", env: { ...clean(), ...extra }, input: "" });
    assert.equal(r.status, 1);
    assert.ok(!r.stderr.includes(ESC), r.stderr);
    assert.match(r.stderr, /tp-abc\\x1b\[31m/, "转义成可见的 \\x1b");
  }
});

test("错误消息里的 Tab 与换行：Tab 可见转义，夹带的换行伪造不出从行首开始的 error:", () => {
  const { d } = ledgerWithTasks();
  for (const [extra, pre] of [[{ FORCE_COLOR: "1", CLAUDECODE: "1" }, []], [{ FORCE_COLOR: "1" }, ["--json"]]] as const) {
    const run2 = (id: string) => spawnSync(process.execPath, [CLI, "-C", d, ...pre, "show", id], { encoding: "utf8", env: { ...clean(), ...extra }, input: "" });
    const tab = run2("tp-abc\terror");
    assert.ok(!tab.stderr.includes("\t"), JSON.stringify(tab.stderr));
    const forged = run2("tp-abc\nerror: forged");
    assert.equal(forged.stderr.split("\n").filter((l) => l.startsWith("error:")).length, 1, JSON.stringify(forged.stderr));
  }
});

test("管道里的 ls：stdout 只有数据行——空结果、截断、FORCE_COLOR 都不多出一行", () => {
  const { d } = ledgerWithTasks();
  const lines = (extra: Record<string, string>, ...args: string[]) =>
    spawnSync(process.execPath, [CLI, "-C", d, "ls", ...args], { encoding: "utf8", env: { ...clean(), ...extra }, input: "" });
  for (const extra of [{}, { FORCE_COLOR: "1" }] as Record<string, string>[]) {
    assert.equal(lines(extra).stdout.trimEnd().split("\n").length, 2, "两条任务就是两行");
    const empty = lines(extra, "--label", "nope");
    assert.equal(empty.stdout, "", "没有匹配：stdout 为空");
    assert.match(empty.stderr, /No tasks match/, "提示在 stderr");
    const cut = lines(extra, "--limit", "1");
    assert.equal(cut.stdout.trimEnd().split("\n").length, 1, "截断：只有显示的那一行");
    assert.match(cut.stderr, /Showing 1 of 2 tasks/);
  }
});

test("反向对照：只给 FORCE_COLOR 时各命令真的上色，错误（stderr）也上色", () => {
  const { d, a } = ledgerWithTasks();
  const run1 = (...args: string[]) => spawnSync(process.execPath, [CLI, "-C", d, ...args], { encoding: "utf8", env: { ...clean(), FORCE_COLOR: "1" }, input: "" });
  for (const args of [["ls"], ["show", a], ["claim", a], ["doctor"], ["done", a, "--yes"]]) {
    assert.ok(run1(...args).stdout.includes(ESC), `todopi ${args.join(" ")}`);
  }
  const err = run1("show", "tp-nope");
  assert.notEqual(err.status, 0);
  assert.ok(err.stderr.includes(ESC) && /error:/.test(err.stderr.replace(/\x1b\[[0-9;]*m/g, "")));
});
