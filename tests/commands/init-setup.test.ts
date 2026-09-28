import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
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
