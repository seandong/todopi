import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runSetup } from "../../src/commands/setup.ts";
import { ensureClaudeHooks } from "../../src/format/claude-settings.ts";
import { ensureAgentsImport, hasAgentsImport } from "../../src/format/claude-md.ts";
import { sessionFromHookPayload } from "../../src/commands/hook.ts";
import { EXIT, CliError } from "../../src/exit.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "todopi-setup-"));
function repo(): string {
  const d = tmp();
  runInit({ directory: d, prefix: "tp" });
  return d;
}
const code = (c: number) => (e: unknown) => e instanceof CliError && e.code === c;
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const commands = (settings: { hooks: Record<string, { hooks: { command: string }[] }[]> }, event: string) =>
  (settings.hooks[event] ?? []).flatMap((g) => g.hooks.map((h) => h.command));

test("项目级：写 .claude/settings.json 的 SessionStart 与 SessionEnd 钩子，建含 @AGENTS.md 的 CLAUDE.md", () => {
  const d = repo();
  const r = runSetup({ directory: d, agent: "claude" });
  assert.deepEqual(r.files.map((f) => [f.path, f.status]), [
    [join(d, ".claude", "settings.json"), "created"], [join(d, "CLAUDE.md"), "created"]]);
  const s = json(join(d, ".claude", "settings.json"));
  assert.deepEqual(commands(s, "SessionStart"), ["todopi prime --hook"]);
  assert.deepEqual(commands(s, "SessionEnd"), ["todopi handoff --check --hook"]);
  assert.equal(s.hooks.SessionStart[0].matcher, undefined, "不设 matcher：覆盖 startup / resume / clear / compact / fork");
  assert.equal("PostCompact" in s.hooks, false, "压缩后注入靠 SessionStart 的 compact 来源（PRD §17 重核）");
  assert.equal(readFileSync(join(d, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
});

test("幂等：再跑一次什么都不写，不会有第二份钩子", () => {
  const d = repo();
  runSetup({ directory: d, agent: "claude" });
  const before = readFileSync(join(d, ".claude", "settings.json"), "utf8");
  const r = runSetup({ directory: d, agent: "claude" });
  assert.deepEqual(r.files.map((f) => f.status), ["unchanged", "unchanged"]);
  assert.equal(readFileSync(join(d, ".claude", "settings.json"), "utf8"), before);
});

test("已有的 settings.json：别的键、别的钩子原样保留，只补我们的", () => {
  const d = tmp();
  const p = join(d, "settings.json");
  writeFileSync(p, JSON.stringify({
    model: "opus", permissions: { allow: ["Bash(ls)"] },
    hooks: { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "echo hi" }] }],
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }] },
  }));
  assert.equal(ensureClaudeHooks(p), "updated");
  const s = json(p);
  assert.equal(s.model, "opus");
  assert.deepEqual(s.permissions, { allow: ["Bash(ls)"] });
  assert.deepEqual(commands(s, "SessionStart"), ["echo hi", "todopi prime --hook"]);
  assert.deepEqual(commands(s, "PreToolUse"), ["guard.sh"]);
  // 我们的钩子已经在（哪怕在别的 matcher 组里）：不再加。
  assert.equal(ensureClaudeHooks(p), "unchanged");
});

test("settings.json 不是合法 JSON、不是对象、hooks 形状不对：拒绝，文件不动", () => {
  for (const content of ["{ not json", "[1, 2]", JSON.stringify({ hooks: [] }), JSON.stringify({ hooks: { SessionStart: {} } })]) {
    const d = tmp();
    const p = join(d, "settings.json");
    writeFileSync(p, content);
    assert.throws(() => ensureClaudeHooks(p), code(EXIT.usage), content);
    assert.equal(readFileSync(p, "utf8"), content);
  }
});

test("CLAUDE.md：没有就建；有但缺导入就在末尾追加一行，原文一个字节不动；已有就不动", () => {
  const d = tmp();
  const p = join(d, "CLAUDE.md");
  for (const [before, after] of [
    ["# Notes\n\nkeep me  \n", "# Notes\n\nkeep me  \n\n@AGENTS.md\n"],
    ["no trailing newline", "no trailing newline\n\n@AGENTS.md\n"],
    ["ends with blank\n\n", "ends with blank\n\n@AGENTS.md\n"],
  ] as const) {
    writeFileSync(p, before);
    assert.equal(ensureAgentsImport(p), "appended");
    assert.equal(readFileSync(p, "utf8"), after);
    assert.equal(ensureAgentsImport(p), "unchanged");
  }
  assert.equal(hasAgentsImport("x\n  @./AGENTS.md  \n"), true);
  assert.equal(hasAgentsImport("Read and follow AGENTS.md and @AGENTS.md later"), false, "混在句子里的不算：不猜");
});

test("--user：钩子写进 ~/.claude/settings.json；在项目里照样确保项目的 CLAUDE.md；不在项目里跳过并说明", () => {
  const home = tmp();
  const d = repo();
  const r = runSetup({ directory: d, agent: "claude", user: true, home });
  assert.deepEqual(r.files.map((f) => f.path), [join(home, ".claude", "settings.json"), join(d, "CLAUDE.md")]);
  assert.equal(existsSync(join(d, ".claude", "settings.json")), false, "用户级不写项目的 settings.json");
  const outside = tmp();
  const r2 = runSetup({ directory: outside, agent: "claude", user: true, home });
  assert.deepEqual(r2.files.map((f) => [f.path, f.status]), [[join(home, ".claude", "settings.json"), "unchanged"]]);
  assert.equal(r2.notes.length, 1);
});

test("不在项目里又不是 --user：退出 1，什么都不写；不支持的 agent：退出 1", () => {
  const d = tmp();
  assert.throws(() => runSetup({ directory: d, agent: "claude" }), code(EXIT.usage));
  assert.equal(existsSync(join(d, ".claude")), false);
  assert.throws(() => runSetup({ directory: repo(), agent: "vim" }), code(EXIT.usage));
});

test("钩子载荷里的会话 id：session_id、sessionID、sessionId；取不到返回 undefined，绝不抛", () => {
  assert.equal(sessionFromHookPayload('{"session_id":"a","hook_event_name":"SessionStart"}'), "a");
  assert.equal(sessionFromHookPayload('{"sessionID":"b"}'), "b");
  assert.equal(sessionFromHookPayload('{"sessionId":"c"}'), "c");
  for (const bad of ["", "not json", "[]", "null", '{"session_id":""}', '{"session_id":5}']) {
    assert.equal(sessionFromHookPayload(bad), undefined, bad);
  }
  mkdirSync(join(tmp(), "x"));
});
