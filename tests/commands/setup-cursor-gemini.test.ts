import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runSetup } from "../../src/commands/setup.ts";
import { ensureCursorHooks, ensureGeminiSettings } from "../../src/format/claude-settings.ts";
import { CURSOR_RULE, CURSOR_RULE_MARKER } from "../../src/format/cursor-rule.ts";
import { compactionGate, directoryFromHookPayload, sessionFromHookPayload, wrapHookOutput } from "../../src/commands/hook.ts";
import { EXIT, CliError } from "../../src/exit.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "todopi-setup-cg-"));
function repo(): string {
  const d = tmp();
  runInit({ directory: d, prefix: "tp" });
  return d;
}
const code = (c: number) => (e: unknown) => e instanceof CliError && e.code === c;
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const groupCommands = (s: { hooks: Record<string, { hooks: { command: string }[] }[]> }, event: string) =>
  (s.hooks[event] ?? []).flatMap((g) => g.hooks.map((h) => h.command));

// ---- Gemini ----

test("gemini：写 .gemini/settings.json 的四个钩子，并让 context.fileName 含 AGENTS.md（保留 GEMINI.md）", () => {
  const d = repo();
  const r = runSetup({ directory: d, agent: "gemini" });
  const p = join(d, ".gemini", "settings.json");
  assert.deepEqual(r.files.map((f) => [f.path, f.status]), [[p, "created"]]);
  const s = json(p);
  assert.deepEqual(groupCommands(s, "SessionStart"), ["todopi --agent gemini prime --hook --hook-json gemini:SessionStart"]);
  assert.deepEqual(groupCommands(s, "PreCompress"), ["todopi --agent gemini prime --hook --mark-compacted"]);
  assert.equal(s.hooks.PreCompress[0].matcher, "manual", "自动的 PreCompress 每轮都触发（不一定真压缩），只认 /compress");
  assert.equal(s.hooks.SessionStart[0].matcher, undefined);
  assert.deepEqual(groupCommands(s, "BeforeAgent"), ["todopi --agent gemini prime --hook --if-compacted --hook-json gemini:BeforeAgent"]);
  assert.deepEqual(groupCommands(s, "SessionEnd"), ["todopi --agent gemini handoff --check --hook"]);
  assert.deepEqual(s.context, { fileName: ["AGENTS.md", "GEMINI.md"] });
  assert.deepEqual(runSetup({ directory: d, agent: "gemini" }).files.map((f) => f.status), ["unchanged"], "幂等");
});

test("gemini：已有的 context.fileName 是字符串或数组就补上 AGENTS.md，已含就不动；别的键原样；形状不对拒绝", () => {
  const d = tmp();
  const p = join(d, "settings.json");
  writeFileSync(p, JSON.stringify({ context: { fileName: "CONTEXT.md", includeDirectories: ["x"] }, model: { name: "m" } }));
  ensureGeminiSettings(p);
  assert.deepEqual(json(p).context, { fileName: ["CONTEXT.md", "AGENTS.md"], includeDirectories: ["x"] });
  assert.deepEqual(json(p).model, { name: "m" });

  writeFileSync(p, JSON.stringify({ context: { fileName: ["A.md", "B.md"] } }));
  ensureGeminiSettings(p);
  assert.deepEqual(json(p).context.fileName, ["A.md", "B.md", "AGENTS.md"]);

  for (const already of ["AGENTS.md", ["GEMINI.md", "AGENTS.md"]]) {
    writeFileSync(p, JSON.stringify({ context: { fileName: already } }));
    ensureGeminiSettings(p);
    assert.deepEqual(json(p).context.fileName, already, "已含 AGENTS.md：不改写法");
  }

  for (const bad of [{ context: "x" }, { context: null }, { context: { fileName: 3 } }, { context: { fileName: ["a", 1] } }]) {
    writeFileSync(p, JSON.stringify(bad));
    const before = readFileSync(p, "utf8");
    assert.throws(() => ensureGeminiSettings(p), code(EXIT.usage));
    assert.equal(readFileSync(p, "utf8"), before, "拒绝时文件不动");
  }
});

test("gemini：钩子都装好、只差 AGENTS.md 时也算要更新；--user 写 ~/.gemini/settings.json", () => {
  const d = repo();
  runSetup({ directory: d, agent: "gemini" });
  const p = join(d, ".gemini", "settings.json");
  const s = json(p);
  s.context = { fileName: "GEMINI.md" };
  writeFileSync(p, JSON.stringify(s));
  assert.deepEqual(runSetup({ directory: d, agent: "gemini" }).files.map((f) => f.status), ["updated"]);
  assert.deepEqual(json(p).context.fileName, ["GEMINI.md", "AGENTS.md"]);

  const home = tmp();
  const r = runSetup({ directory: tmp(), agent: "gemini", user: true, home });
  assert.deepEqual(r.files.map((f) => [f.path, f.status]), [[join(home, ".gemini", "settings.json"), "created"]]);
});

test("gemini：PreCompress 只认 matcher 恰为 manual 的组——不设 matcher 或是 auto 的同名组不算，另补一组并提示", () => {
  const d = tmp();
  const p = join(d, "settings.json");
  const cmd = "todopi --agent gemini prime --hook --mark-compacted";
  for (const g of [{}, { matcher: "auto" }, { matcher: "*" }]) {
    writeFileSync(p, JSON.stringify({ context: { fileName: "AGENTS.md" }, hooks: { PreCompress: [{ ...g, hooks: [{ type: "command", command: cmd }] }] } }));
    const r = ensureGeminiSettings(p);
    const groups = json(p).hooks.PreCompress;
    assert.equal(groups.length, 2, JSON.stringify(g));
    assert.deepEqual(groups[1], { matcher: "manual", hooks: [{ type: "command", command: cmd }] });
    assert.match(r.notes.join("\n"), /runs twice/);
  }
  writeFileSync(p, JSON.stringify({ hooks: { PreCompress: [{ matcher: "manual", hooks: [{ type: "command", command: cmd, timeout: 5 }] }] } }));
  ensureGeminiSettings(p);
  assert.equal(json(p).hooks.PreCompress.length, 1, "恰为 manual 的算装好");
});

// ---- Cursor ----

test("cursor：写 .cursor/hooks.json（version 1，sessionStart 注入 + sessionEnd）与始终生效的规则文件；幂等", () => {
  const d = repo();
  const r = runSetup({ directory: d, agent: "cursor" });
  const hooks = join(d, ".cursor", "hooks.json"), rule = join(d, ".cursor", "rules", "todopi.mdc");
  assert.deepEqual(r.files.map((f) => [f.path, f.status]), [[hooks, "created"], [rule, "created"]]);
  assert.deepEqual(json(hooks), { version: 1, hooks: {
    sessionStart: [{ command: "todopi --agent cursor prime --hook --hook-json cursor" }],
    sessionEnd: [{ command: "todopi --agent cursor handoff --check --hook" }] } });
  const text = readFileSync(rule, "utf8");
  assert.equal(text, CURSOR_RULE);
  assert.deepEqual(text.split("\n").slice(0, 4), ["---", CURSOR_RULE_MARKER, "alwaysApply: true", "---"]);
  assert.match(text, /compacted, run `todopi prime`/);
  assert.deepEqual(runSetup({ directory: d, agent: "cursor" }).files.map((f) => f.status), ["unchanged", "unchanged"]);
});

test("cursor hooks.json：别的钩子与键原样保留，只往末尾补；带 timeout 的同命令算装好；多了别的键（matcher 等）的不算", () => {
  const d = tmp();
  const p = join(d, "hooks.json");
  writeFileSync(p, JSON.stringify({ version: 1, extra: { a: 1 }, hooks: {
    sessionStart: [{ command: "./mine.sh" }, { command: "todopi --agent cursor prime --hook --hook-json cursor", timeout: 10 }],
    sessionEnd: [{ command: "todopi --agent cursor handoff --check --hook", matcher: "x" }],
    stop: [{ command: "./stop.sh" }] } }));
  chmodSync(p, 0o600);
  assert.equal(ensureCursorHooks(p).status, "updated");
  const s = json(p);
  assert.deepEqual(s.extra, { a: 1 });
  assert.deepEqual(s.hooks.stop, [{ command: "./stop.sh" }]);
  assert.equal(s.hooks.sessionStart.length, 2, "带正数 timeout 的算装好");
  assert.deepEqual(s.hooks.sessionEnd.at(-1), { command: "todopi --agent cursor handoff --check --hook" });
  assert.equal(s.hooks.sessionEnd.length, 2);
  assert.equal(statSync(p).mode & 0o777, 0o600, "权限位不变");
});

test("cursor hooks.json：不是 JSON、不是对象、没有 version 1、hooks 或事件形状不对、非法 UTF-8、符号链接：拒绝，文件不动", () => {
  const d = tmp();
  const p = join(d, "hooks.json");
  for (const bad of ["{", "[]", "null", "\"x\"", "{\"hooks\":{}}", "{\"version\":2}", "{\"version\":1,\"hooks\":[]}", "{\"version\":1,\"hooks\":{\"sessionStart\":{}}}"]) {
    writeFileSync(p, bad);
    assert.throws(() => ensureCursorHooks(p), code(EXIT.usage), bad);
    assert.equal(readFileSync(p, "utf8"), bad);
  }
  const invalid = Buffer.concat([Buffer.from("{\"version\":1,\"x\":\""), Buffer.from([0xff]), Buffer.from("\"}")]);
  writeFileSync(p, invalid);
  assert.throws(() => ensureCursorHooks(p), code(EXIT.usage), "非法 UTF-8 在字符串里：JSON 能解析，照样拒绝");
  assert.ok(readFileSync(p).equals(invalid));
  const target = join(d, "real.json");
  writeFileSync(target, "{\"version\":1}");
  const link = join(d, "link.json");
  symlinkSync(target, link);
  assert.throws(() => ensureCursorHooks(link), code(EXIT.usage));
  assert.equal(readFileSync(target, "utf8"), "{\"version\":1}");
});

test("cursor 规则文件：第二行是我们的标记才替换；用户自己的同名文件拒绝", () => {
  const d = repo();
  const rule = join(d, ".cursor", "rules", "todopi.mdc");
  mkdirSync(join(d, ".cursor", "rules"), { recursive: true });
  writeFileSync(rule, `---\n${CURSOR_RULE_MARKER}\nalwaysApply: false\n---\nold\n`);
  assert.equal(runSetup({ directory: d, agent: "cursor" }).files[1]!.status, "updated");
  assert.equal(readFileSync(rule, "utf8"), CURSOR_RULE);
  writeFileSync(rule, `${CURSOR_RULE_MARKER}\n---\nmine\n`);
  assert.throws(() => runSetup({ directory: d, agent: "cursor" }), code(EXIT.usage), "标记在第一行不算");
  assert.equal(readFileSync(rule, "utf8"), `${CURSOR_RULE_MARKER}\n---\nmine\n`);
});

test("cursor --user：钩子写 ~/.cursor/hooks.json；规则文件只在项目里写，不在项目里说明", () => {
  const home = tmp();
  const r = runSetup({ directory: tmp(), agent: "cursor", user: true, home });
  assert.deepEqual(r.files.map((f) => [f.path, f.status]), [[join(home, ".cursor", "hooks.json"), "created"]]);
  assert.match(r.notes.join("\n"), /todopi\.mdc/);
  const d = repo();
  const r2 = runSetup({ directory: d, agent: "cursor", user: true, home: tmp() });
  assert.equal(r2.files.length, 2);
  assert.ok(existsSync(join(d, ".cursor", "rules", "todopi.mdc")));
});

// ---- 钩子的 JSON 输出与压缩标记 ----

test("wrapHookOutput：cursor 用 additional_context，gemini 用 hookSpecificOutput；空内容不输出；未知形状退出 1", () => {
  assert.equal(wrapHookOutput("cursor", "hi\n"), "{\"additional_context\":\"hi\\n\"}\n");
  for (const ev of ["SessionStart", "BeforeAgent"]) {
    assert.deepEqual(JSON.parse(wrapHookOutput(`gemini:${ev}`, "x")), { hookSpecificOutput: { hookEventName: ev, additionalContext: "x" } });
  }
  assert.equal(wrapHookOutput("cursor", " \n"), "");
  for (const bad of ["gemini:PreCompress", "gemini", "Cursor", "gemini:SessionStartX"]) {
    assert.throws(() => wrapHookOutput(bad, "x"), code(EXIT.usage), bad);
  }
});

test("压缩标记：mark 之后 take 恰好一次为真；按会话隔离；没有会话 id 时按 actor", () => {
  const d = repo();
  assert.equal(compactionGate(d, "take", "s1"), false, "没打过标记");
  compactionGate(d, "mark", "s1");
  assert.equal(compactionGate(d, "take", "s2"), false, "别的会话取不走");
  assert.equal(compactionGate(d, "take", "s1"), true);
  assert.equal(compactionGate(d, "take", "s1"), false, "取走之后就没了");
  compactionGate(d, "mark", undefined, "alice");
  assert.equal(compactionGate(d, "take", undefined, "bob"), false);
  assert.equal(compactionGate(d, "take", undefined, "alice"), true);
});

test("Cursor 的钩子载荷用 conversation_id；session_id 优先", () => {
  assert.equal(sessionFromHookPayload(JSON.stringify({ conversation_id: "c1", hook_event_name: "sessionStart" })), "c1");
  assert.equal(sessionFromHookPayload(JSON.stringify({ session_id: "s", conversation_id: "c" })), "s");
});

test("Cursor 的 workspace_roots：取第一个找得到账本的根（多根工作区，F17 评审）；都找不到返回 undefined", () => {
  const a = repo(), b = repo(), none = tmp();
  assert.equal(directoryFromHookPayload(JSON.stringify({ workspace_roots: [a, b] })), a);
  assert.equal(directoryFromHookPayload(JSON.stringify({ workspace_roots: [none, b] })), b, "第一个根没有账本");
  mkdirSync(join(a, "sub"));
  assert.equal(directoryFromHookPayload(JSON.stringify({ workspace_roots: [join(a, "sub")] })), join(a, "sub"), "根在项目里的子目录也算");
  for (const bad of ["", "{", "[]", "null", JSON.stringify({ workspace_roots: [] }), JSON.stringify({ workspace_roots: ["", none] }),
    JSON.stringify({ workspace_roots: a }), JSON.stringify({ workspace_roots: [3] }), JSON.stringify({ cwd: a })]) {
    assert.equal(directoryFromHookPayload(bad), undefined, bad);
  }
});

test("旧版的 Gemini 与 Cursor 钩子：就地改成带 --agent 的命令（F22）", () => {
  const d = tmp();
  const g = join(d, "settings.json");
  writeFileSync(g, JSON.stringify({ context: { fileName: "AGENTS.md" }, hooks: {
    PreCompress: [{ matcher: "manual", hooks: [{ type: "command", command: "todopi prime --hook --mark-compacted" }] }] } }));
  ensureGeminiSettings(g);
  assert.deepEqual(json(g).hooks.PreCompress, [{ matcher: "manual", hooks: [{ type: "command", command: "todopi --agent gemini prime --hook --mark-compacted" }] }]);
  const c = join(d, "hooks.json");
  writeFileSync(c, JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: "./mine.sh" }, { command: "todopi prime --hook --hook-json cursor", timeout: 5 }] } }));
  ensureCursorHooks(c);
  assert.deepEqual(json(c).hooks.sessionStart, [{ command: "./mine.sh" }, { command: "todopi --agent cursor prime --hook --hook-json cursor", timeout: 5 }]);
});
