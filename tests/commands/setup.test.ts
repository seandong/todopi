import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, chmodSync, symlinkSync, lstatSync } from "node:fs";
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
  assert.equal(ensureClaudeHooks(p).status, "updated");
  const s = json(p);
  assert.equal(s.model, "opus");
  assert.deepEqual(s.permissions, { allow: ["Bash(ls)"] });
  assert.deepEqual(commands(s, "SessionStart"), ["echo hi", "todopi prime --hook"]);
  assert.deepEqual(commands(s, "PreToolUse"), ["guard.sh"]);
  assert.equal(ensureClaudeHooks(p).status, "unchanged");
});

test("settings.json 不是合法 JSON、不是对象、hooks 形状不对：拒绝，文件不动", () => {
  for (const content of ["{ not json", "[1, 2]", JSON.stringify({ hooks: [] }), JSON.stringify({ hooks: { SessionStart: {} } }),
    // 显式的 null 不是「没有」；组与处理器的形状也要对（F14 评审）。
    JSON.stringify({ hooks: null }), JSON.stringify({ hooks: { SessionStart: null } }),
    JSON.stringify({ hooks: { SessionStart: [42] } }), JSON.stringify({ hooks: { SessionEnd: [{ hooks: "x" }] } })]) {
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

test("更新已有的 settings.json 与 CLAUDE.md：权限位不变（用户的设置可能含密钥）（F14 评审）", () => {
  const d = tmp();
  const p = join(d, "settings.json");
  writeFileSync(p, JSON.stringify({ apiKey: "private" }));
  chmodSync(p, 0o600);
  ensureClaudeHooks(p);
  assert.equal(statSync(p).mode & 0o777, 0o600);
  const m = join(d, "CLAUDE.md");
  writeFileSync(m, "# mine\n");
  chmodSync(m, 0o640);
  ensureAgentsImport(m);
  assert.equal(statSync(m).mode & 0o777, 0o640);
});

test("我们的命令已在、但 matcher 只覆盖 startup：不改用户的组、不再加一组，如实提示压缩后不会注入（F14 评审）", () => {
  const d = tmp();
  const p = join(d, "settings.json");
  const narrow = { hooks: { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "todopi prime --hook" }] }],
    SessionEnd: [{ hooks: [{ type: "command", command: "todopi handoff --check --hook" }] }] } };
  writeFileSync(p, JSON.stringify(narrow));
  const before = readFileSync(p, "utf8");
  const r = ensureClaudeHooks(p);
  assert.equal(r.status, "unchanged");
  assert.equal(readFileSync(p, "utf8"), before);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0]!, /will not be re-injected after compaction/);
  // 覆盖 compact 的写法（正则、*）算装好，不提示。
  for (const matcher of ["startup|compact|resume", "*", ".*"]) {
    writeFileSync(p, JSON.stringify({ hooks: { ...narrow.hooks, SessionStart: [{ matcher, hooks: narrow.hooks.SessionStart[0]!.hooks }] } }));
    assert.deepEqual(ensureClaudeHooks(p).notes, [], matcher);
  }
});

test("符号链接：拒绝，不把链接换成普通文件（F14 评审）", () => {
  const d = tmp();
  writeFileSync(join(d, "target.json"), "{}");
  symlinkSync(join(d, "target.json"), join(d, "link.json"));
  assert.throws(() => ensureClaudeHooks(join(d, "link.json")), code(EXIT.usage));
  assert.equal(lstatSync(join(d, "link.json")).isSymbolicLink(), true);
  writeFileSync(join(d, "t.md"), "# x\n");
  symlinkSync(join(d, "t.md"), join(d, "CLAUDE.md"));
  assert.throws(() => ensureAgentsImport(join(d, "CLAUDE.md")), code(EXIT.usage));
  assert.equal(readFileSync(join(d, "t.md"), "utf8"), "# x\n");
});

test("CLAUDE.md 有非法 UTF-8 字节：拒绝、字节不动；围栏里的 @AGENTS.md 不算导入（F14 评审）", () => {
  const d = tmp();
  const m = join(d, "CLAUDE.md");
  const bytes = Buffer.from([0x61, 0x80, 0x62, 0x0a]);
  writeFileSync(m, bytes);
  assert.throws(() => ensureAgentsImport(m), code(EXIT.usage));
  assert.ok(readFileSync(m).equals(bytes));
  assert.equal(hasAgentsImport("```md\n@AGENTS.md\n```\n"), false);
  writeFileSync(m, "```md\n@AGENTS.md\n```\n");
  assert.equal(ensureAgentsImport(m), "appended");
  assert.equal(readFileSync(m, "utf8"), "```md\n@AGENTS.md\n```\n\n@AGENTS.md\n");
});
