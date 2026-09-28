import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `init --setup <agent>`（tp-jyvt6i，dogfood 反馈）：初始化时一并接入 agent，等价于 init 之后 setup。
 * 可重复、可逗号分隔；未知的 agent 在写任何文件之前报错。
 */
const CLI = join(process.cwd(), "src", "cli.ts");
const repo = () => {
  const d = mkdtempSync(join(tmpdir(), "todopi-init-setup-"));
  spawnSync("git", ["init", "-q"], { cwd: d });
  return d;
};
const env = { ...process.env, HOME: mkdtempSync(join(tmpdir(), "todopi-init-setup-home-")) };
const run = (d: string, ...args: string[]) => spawnSync(process.execPath, [CLI, "-C", d, ...args], { encoding: "utf8", env, input: "" });

test("init --setup claude：账本、协议与 Claude Code 的两个文件一次写好；Next 不再提示 setup", () => {
  const d = repo();
  const r = run(d, "init", "--setup", "claude");
  assert.equal(r.status, 0, r.stderr);
  for (const f of [".todopi/config.yml", "AGENTS.md", ".claude/settings.json", "CLAUDE.md"]) assert.ok(existsSync(join(d, f)), f);
  assert.match(r.stdout, /^ +Created \.claude\/settings\.json$/m);
  assert.match(r.stdout, /^ +Created CLAUDE\.md$/m);
  assert.match(r.stdout, /todopi add/);
  assert.doesNotMatch(r.stdout, /todopi setup/, "已经接入了，不再提示");
});

test("可重复、可逗号分隔、重复的只装一次", () => {
  for (const args of [["--setup", "claude,codex"], ["--setup", "claude", "--setup", "codex"], ["--setup", "claude, codex,claude"]]) {
    const d = repo();
    const r = run(d, "init", ...args);
    assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`);
    assert.ok(existsSync(join(d, ".claude", "settings.json")) && existsSync(join(d, ".codex", "hooks.json")), args.join(" "));
    assert.equal(r.stdout.match(/Created \.claude\/settings\.json/g)?.length, 1, args.join(" "));
  }
});

test("未知的 agent：写任何文件之前报错退出 1", () => {
  const d = repo();
  const r = run(d, "init", "--setup", "claude,nope");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^error: .*nope/m);
  assert.ok(!existsSync(join(d, ".todopi")), "账本不该建出来");
  assert.ok(!existsSync(join(d, ".claude")), "claude 也不该装");
});

test("--json：InitReport 多一个 setup 数组，每个 agent 一份 SetupReport；不给 --setup 时没有这个字段", () => {
  const d = repo();
  const r = JSON.parse(run(d, "--json", "init", "--setup", "codex,claude").stdout) as { setup?: { agent: string }[] };
  assert.deepEqual(r.setup?.map((s) => s.agent), ["codex", "claude"]);
  const plain = JSON.parse(run(repo(), "--json", "init").stdout) as Record<string, unknown>;
  assert.equal("setup" in plain, false);
});

test("--quiet：结果（每个文件）留下，提示（Next、note）去掉", () => {
  const d = repo();
  const r = run(d, "--quiet", "init", "--setup", "codex");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Created \.codex\/hooks\.json/);
  assert.doesNotMatch(r.stdout, /Next|note:|trust/);
});

test("只有空项的 --setup（\" , \"、空串）：用法错误，什么都不写", () => {
  for (const v of [" , ", "", ","]) {
    const d = repo();
    const r = run(d, "init", "--setup", v);
    assert.equal(r.status, 1, JSON.stringify(v));
    assert.match(r.stderr, /--setup needs at least one agent/);
    assert.ok(!existsSync(join(d, ".todopi")), JSON.stringify(v));
  }
});

test("第二家失败：错误里说清已经写了什么、哪家失败、还差哪家、跑什么；文本与 --json 都是（stdout 为空）", () => {
  for (const pre of [[], ["--json"]]) {
    const d = repo();
    // Claude Code 的 settings.json 是指向项目外的符号链接：setup claude 会拒绝（原子替换会拆断链接）
    const outside = mkdtempSync(join(tmpdir(), "todopi-init-setup-outside-"));
    writeFileSync(join(outside, "settings.json"), "{}\n");
    mkdirSync(join(d, ".claude"));
    symlinkSync(join(outside, "settings.json"), join(d, ".claude", "settings.json"));
    const r = run(d, ...pre, "init", "--setup", "codex,claude,gemini");
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.stdout, "", "出错时 stdout 为空");
    assert.match(r.stderr, /^error: setup claude failed: /m);
    assert.match(r.stderr, /Already written: \.todopi\/config\.yml, \.todopi\/\.gitignore, AGENTS\.md, \.codex\/hooks\.json\./);
    assert.match(r.stderr, /Not set up yet: claude, gemini\. .*todopi -C \S+ setup claude && todopi -C \S+ setup gemini/);
    assert.ok(existsSync(join(d, ".codex", "hooks.json")) && !existsSync(join(d, ".gemini")));
  }
});

test("失败的那一家自己已写了一部分：不说「别的都没动」，说它可能写了一部分、重跑安全", () => {
  const d = repo();
  run(d, "init");
  // CLAUDE.md 指向项目外：setup claude 先写好 .claude/settings.json，再在 CLAUDE.md 上被拒
  const outside = mkdtempSync(join(tmpdir(), "todopi-init-setup-outside-"));
  writeFileSync(join(outside, "CLAUDE.md"), "x\n");
  symlinkSync(join(outside, "CLAUDE.md"), join(d, "CLAUDE.md"));
  const r = run(d, "init", "--setup", "claude");
  assert.equal(r.status, 1, r.stderr);
  assert.doesNotMatch(r.stderr, /Nothing else was changed/);
  assert.match(r.stderr, /setup claude may have written some of its own files before it failed; running it again is safe/);
});

test("不是 CliError 的失败（悬空的符号链接）也带上已写的文件与恢复命令", () => {
  const d = repo();
  mkdirSync(join(d, ".claude"));
  symlinkSync(join(d, "nowhere", "settings.json"), join(d, ".claude", "settings.json"));
  const r = run(d, "init", "--setup", "codex,claude");
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /^error: setup claude failed: /m);
  assert.match(r.stderr, /Already written: .*\.codex\/hooks\.json\./);
  assert.match(r.stderr, /todopi -C \S+ setup claude/);
});

// 让 shell 真的解析提示里的命令：PATH 上放一个叫 todopi 的小脚本，指向本仓库的 CLI
const SHIM = mkdtempSync(join(tmpdir(), "todopi-init-setup-shim-"));
writeFileSync(join(SHIM, "todopi"), `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`, { mode: 0o755 });

/** 在名字里带 `name` 的项目里让 claude 失败，返回错误里建议的恢复命令与项目目录 */
function failClaude(name: string) {
  const parent = mkdtempSync(join(tmpdir(), "todopi-init-setup-q-"));
  const d = join(parent, name);
  mkdirSync(d);
  spawnSync("git", ["init", "-q"], { cwd: d });
  const outside = mkdtempSync(join(tmpdir(), "todopi-init-setup-outside-"));
  writeFileSync(join(outside, "settings.json"), "{}\n");
  mkdirSync(join(d, ".claude"));
  symlinkSync(join(outside, "settings.json"), join(d, ".claude", "settings.json"));
  const elsewhere = mkdtempSync(join(tmpdir(), "todopi-init-setup-cwd-"));
  const r = spawnSync(process.execPath, [CLI, "-C", d, "init", "--setup", "codex,claude"], { encoding: "utf8", env, cwd: elsewhere, input: "" });
  assert.equal(r.status, 1);
  rmSync(join(d, ".claude", "settings.json"));
  return { d, elsewhere, stderr: r.stderr };
}

test("用 -C 从项目外跑：提示里的恢复命令交给 /bin/sh 原样执行能跑通（路径含空格与单引号）", () => {
  for (const name of ["plain", "with space", "it's quoted"]) {
    const { d, elsewhere, stderr } = failClaude(name);
    const cmd = /run: (todopi -C .+ setup claude)$/m.exec(stderr)?.[1];
    assert.ok(cmd, stderr);
    const again = spawnSync("/bin/sh", ["-c", cmd], { encoding: "utf8", env: { ...env, PATH: `${SHIM}:${process.env["PATH"] ?? ""}` }, cwd: elsewhere });
    assert.equal(again.status, 0, `${name}: ${cmd}: ${again.stderr}`);
    assert.ok(existsSync(join(d, ".claude", "settings.json")), name);
  }
});

test("路径里有错误出口会转义的字符（Tab、零宽空格）：不给冒称能照抄的命令，改说在项目根下跑", () => {
  for (const name of ["tab\there", "zero\u200bwidth"]) {
    const { stderr } = failClaude(name);
    assert.doesNotMatch(stderr, /todopi -C /, JSON.stringify(name));
    assert.match(stderr, /run from the project root: todopi setup claude$/m, JSON.stringify(name));
  }
});
