import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, chmodSync, symlinkSync, lstatSync, readdirSync } from "node:fs";
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
    JSON.stringify({ hooks: null }), JSON.stringify({ hooks: { SessionStart: null } })]) {
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

test("只认我们写出的标准组（无 matcher / 空 / *）；限定过 matcher 的同名组不改、另补标准组并提示可能重复（评审一至四轮）", () => {
  const d = tmp();
  const p = join(d, "settings.json");
  const end = [{ hooks: [{ type: "command", command: "todopi handoff --check --hook" }] }];
  const ours = (matcher?: string) => ({ ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: "command", command: "todopi prime --hook" }] });
  // 不猜 Claude Code 怎么解释 matcher（精确列表、正则）：限定过的一律不算装好。
  for (const matchers of [["startup"], ["startup", "compact"], ["startup, compact"], ["startup|compact|resume"], [".*"], ["^star"]]) {
    writeFileSync(p, JSON.stringify({ hooks: { SessionStart: matchers.map(ours), SessionEnd: end } }));
    const r = ensureClaudeHooks(p);
    assert.equal(r.status, "updated", JSON.stringify(matchers));
    const got = json(p).hooks.SessionStart.map((g: { matcher?: string }) => g.matcher);
    assert.deepEqual(got, [...matchers, undefined], "原组不动，末尾补一组不带 matcher 的");
    assert.match(r.notes[0]!, /runs twice/);
    assert.equal(ensureClaudeHooks(p).status, "unchanged", "补过之后幂等");
  }
  for (const matcher of [undefined, "", "*"]) {
    writeFileSync(p, JSON.stringify({ hooks: { SessionStart: [ours(matcher)], SessionEnd: end } }));
    assert.deepEqual(ensureClaudeHooks(p), { status: "unchanged", notes: [] }, String(matcher));
  }
});

test("用户别的钩子不校验、原样保留（那是 Claude Code 的事），只往数组末尾加我们的（评审三轮）", () => {
  const d = tmp();
  const p = join(d, "settings.json");
  const odd = [42, { hooks: [{}] }, { matcher: 5, hooks: [{ type: "bogus" }] }, { matcher: "[", hooks: [] }];
  writeFileSync(p, JSON.stringify({ hooks: { SessionStart: odd } }));
  assert.equal(ensureClaudeHooks(p).status, "updated");
  const s = json(p);
  assert.deepEqual(s.hooks.SessionStart.slice(0, 4), odd, "原有条目逐个原样");
  assert.deepEqual(s.hooks.SessionStart[4], { hooks: [{ type: "command", command: "todopi prime --hook" }] });
});

test("同一命令但可能不运行、或输出不进上下文的（if、async、陌生键、非法正则 matcher）：不算装好，补一组标准的（评审三轮）", () => {
  const end = [{ hooks: [{ type: "command", command: "todopi handoff --check --hook" }] }];
  for (const group of [
    { hooks: [{ type: "command", command: "todopi prime --hook", if: "Bash(ls)" }] },
    { hooks: [{ type: "command", command: "todopi prime --hook", async: true }] },
    { hooks: [{ type: "command", command: "todopi prime --hook", something: 1 }] },
    { matcher: "[", hooks: [{ type: "command", command: "todopi prime --hook" }] },
  ]) {
    const d = tmp();
    const p = join(d, "settings.json");
    writeFileSync(p, JSON.stringify({ hooks: { SessionStart: [group], SessionEnd: end } }));
    assert.equal(ensureClaudeHooks(p).status, "updated", JSON.stringify(group));
    const s = json(p);
    assert.deepEqual(s.hooks.SessionStart, [group, { hooks: [{ type: "command", command: "todopi prime --hook" }] }]);
  }
  // timeout、statusMessage 的值类型不对：不算（评审四轮）。
  for (const extra of [{ timeout: "bad" }, { timeout: 0 }, { statusMessage: { x: 1 } }]) {
    const d = tmp();
    const p = join(d, "settings.json");
    writeFileSync(p, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "todopi prime --hook", ...extra }] }], SessionEnd: end } }));
    assert.equal(ensureClaudeHooks(p).status, "updated", JSON.stringify(extra));
  }
  // timeout（正数）、statusMessage（字符串）不影响运行与注入：算装好。
  const d = tmp();
  const p = join(d, "settings.json");
  writeFileSync(p, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "todopi prime --hook", timeout: 30, statusMessage: "priming" }] }], SessionEnd: end } }));
  assert.equal(ensureClaudeHooks(p).status, "unchanged");
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
  assert.equal(hasAgentsImport("```md\n@AGENTS.md\n"), false, "没闭合的围栏照 CommonMark 延伸到文末（Claude Code 这么读）");
  assert.equal(hasAgentsImport("- item\n\n      @AGENTS.md\n"), false, "列表项里的缩进代码块");
  writeFileSync(m, "```md\n@AGENTS.md\n```\n");
  assert.equal(ensureAgentsImport(m), "appended");
  assert.equal(readFileSync(m, "utf8"), "```md\n@AGENTS.md\n```\n\n@AGENTS.md\n");
});

test("settings.json 有非法 UTF-8 字节：拒绝、字节不动（评审五轮）", () => {
  const d = tmp();
  const p = join(d, "settings.json");
  const bytes = Buffer.concat([Buffer.from('{"model":"a'), Buffer.from([0x80]), Buffer.from('b"}')]);
  writeFileSync(p, bytes);
  assert.throws(() => ensureClaudeHooks(p), code(EXIT.usage));
  assert.ok(readFileSync(p).equals(bytes));
});

test("codex：写 .codex/hooks.json（与 Claude Code 同构：SessionStart 不设 matcher + SessionEnd，不装 PostCompact），提示要在 Codex 里信任", () => {
  const d = repo();
  const r = runSetup({ directory: d, agent: "codex" });
  assert.deepEqual(r.files.map((f) => [f.path, f.status]), [[join(d, ".codex", "hooks.json"), "created"]]);
  const s = json(join(d, ".codex", "hooks.json"));
  assert.deepEqual(commands(s, "SessionStart"), ["todopi prime --hook"]);
  assert.deepEqual(commands(s, "SessionEnd"), ["todopi handoff --check --hook"]);
  assert.equal("PostCompact" in s.hooks, false, "Codex 压缩后 SessionStart(compact) 与 PostCompact 都会触发——两个都装会注入两遍");
  assert.ok(r.notes.some((n) => /trust/.test(n)));
  assert.equal(existsSync(join(d, "CLAUDE.md")), false, "Codex 原生读 AGENTS.md");
  const again = runSetup({ directory: d, agent: "codex" });
  assert.deepEqual(again.files.map((f) => f.status), ["unchanged"]);
  assert.deepEqual(again.notes, [], "没改就不提示信任");
  const home = tmp();
  assert.deepEqual(runSetup({ directory: d, agent: "codex", user: true, home }).files.map((f) => f.path), [join(home, ".codex", "hooks.json")]);
});

test("opencode：写 .opencode/plugins/todopi.js；带我们标记的整份替换，不带标记的（用户自己的）拒绝", async () => {
  const { OPENCODE_PLUGIN, PLUGIN_MARKER } = await import("../../src/format/opencode-plugin.ts");
  const d = repo();
  const p = join(d, ".opencode", "plugins", "todopi.js");
  assert.deepEqual(runSetup({ directory: d, agent: "opencode" }).files.map((f) => [f.path, f.status]), [[p, "created"]]);
  assert.equal(readFileSync(p, "utf8"), OPENCODE_PLUGIN);
  assert.deepEqual(runSetup({ directory: d, agent: "opencode" }).files.map((f) => f.status), ["unchanged"]);
  writeFileSync(p, `${PLUGIN_MARKER}\nexport const TodopiPlugin = async () => ({}); // edited by hand\n`);
  assert.deepEqual(runSetup({ directory: d, agent: "opencode" }).files.map((f) => f.status), ["updated"]);
  assert.equal(readFileSync(p, "utf8"), OPENCODE_PLUGIN);
  writeFileSync(p, "export const Mine = async () => ({});\n");
  assert.throws(() => runSetup({ directory: d, agent: "opencode" }), code(EXIT.usage));
  assert.equal(readFileSync(p, "utf8"), "export const Mine = async () => ({});\n");
  // 开头相同、首行不同：不是我们的（评审二轮）。
  const lookalike = "// Generated by `todopi setup opencode`. User wrote this independently.\nexport const UserPlugin = async () => ({});\n";
  writeFileSync(p, lookalike);
  assert.throws(() => runSetup({ directory: d, agent: "opencode" }), code(EXIT.usage));
  assert.equal(readFileSync(p, "utf8"), lookalike);
  const home = tmp();
  assert.deepEqual(runSetup({ directory: d, agent: "opencode", user: true, home }).files.map((f) => f.path),
    [join(home, ".config", "opencode", "plugins", "todopi.js")]);
});

test("opencode 插件：在 session.created / session.compacted 时跑 prime 并按会话缓存，经系统提示注入；没见过的会话补跑", async () => {
  // 用一个假的 Bun `$` 驱动插件本身（真 OpenCode 的实测记在 PRD §17）。
  const { OPENCODE_PLUGIN } = await import("../../src/format/opencode-plugin.ts");
  const dir = tmp();
  const file = join(dir, "plugin.mjs");
  writeFileSync(file, OPENCODE_PLUGIN);
  const { TodopiPlugin } = await import(file);
  const calls: string[] = [];
  let n = 0;
  const $ = (strings: TemplateStringsArray, payload: Buffer) => {
    calls.push(`${strings.join("<payload>")}|${payload.toString()}`);
    const out = { exitCode: 0, stdout: Buffer.from(`## tp-aaaaaa: call ${++n}\n`) };
    const chain = { cwd: () => chain, quiet: () => chain, nothrow: () => Promise.resolve(out) };
    return chain;
  };
  const hooks = await TodopiPlugin({ $, directory: dir });
  const system = async (sessionID?: string) => {
    const out = { system: ["base"] };
    await hooks["experimental.chat.system.transform"]({ sessionID }, out);
    return out.system;
  };
  await hooks.event({ event: { type: "session.created", properties: { info: { id: "s1" } } } });
  assert.deepEqual(calls, ['todopi prime --hook < <payload>|{"sessionID":"s1"}']);
  assert.deepEqual(await system("s1"), ["base", "## tp-aaaaaa: call 1"]);
  assert.deepEqual(await system("s1"), ["base", "## tp-aaaaaa: call 1"], "缓存：不是每一轮都跑 prime");
  assert.equal(calls.length, 1);
  await hooks.event({ event: { type: "session.compacted", properties: { sessionID: "s1" } } });
  assert.deepEqual(await system("s1"), ["base", "## tp-aaaaaa: call 2"], "压缩后刷新");
  assert.deepEqual(await system("s2"), ["base", "## tp-aaaaaa: call 3"], "没见过 created 的会话：第一次用到时补跑");
  assert.deepEqual(await system(undefined), ["base"]);
});

test("悬空的符号链接也算「有东西」：三个写入口都拒绝，链接原样（F15 评审）", async () => {
  const { ensureOpencodePlugin } = await import("../../src/format/opencode-plugin.ts");
  for (const [name, write] of [
    ["settings.json", (p: string) => ensureClaudeHooks(p)],
    ["todopi.js", (p: string) => ensureOpencodePlugin(p)],
    ["CLAUDE.md", (p: string) => ensureAgentsImport(p)],
  ] as const) {
    const d = tmp();
    const p = join(d, name);
    symlinkSync(join(d, "missing-target"), p);
    assert.throws(() => write(p), code(EXIT.usage), name);
    assert.equal(lstatSync(p).isSymbolicLink(), true, name);
    assert.equal(existsSync(join(d, "missing-target")), false, name);
  }
});

test("opencode 插件：prime 失败（todopi 还不在 PATH 上）时不缓存，下一轮重试（F15 评审）", async () => {
  const { OPENCODE_PLUGIN } = await import("../../src/format/opencode-plugin.ts");
  const dir = tmp();
  const file = join(dir, "plugin.mjs");
  writeFileSync(file, OPENCODE_PLUGIN);
  const { TodopiPlugin } = await import(file);
  let installed = false;
  const $ = () => {
    const out = installed ? { exitCode: 0, stdout: Buffer.from("## tp-aaaaaa: ok\n") } : { exitCode: 127, stdout: Buffer.from("") };
    const chain = { cwd: () => chain, quiet: () => chain, nothrow: () => Promise.resolve(out) };
    return chain;
  };
  const hooks = await TodopiPlugin({ $, directory: dir });
  await hooks.event({ event: { type: "session.created", properties: { info: { id: "s1" } } } });
  const first = { system: ["base"] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, first);
  assert.deepEqual(first.system, ["base"]);
  installed = true;
  const second = { system: ["base"] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, second);
  assert.deepEqual(second.system, ["base", "## tp-aaaaaa: ok"], "装好之后下一轮就注入上了");
});

test("pi：写 .pi/extensions/todopi.ts（--user：~/.pi/agent/extensions/），提示信任项目；带标记才替换", async () => {
  const { PI_EXTENSION, PI_MARKER } = await import("../../src/format/pi-extension.ts");
  const d = repo();
  const p = join(d, ".pi", "extensions", "todopi.ts");
  const r = runSetup({ directory: d, agent: "pi" });
  assert.deepEqual(r.files.map((f) => [f.path, f.status]), [[p, "created"]]);
  assert.ok(r.notes.some((n) => /trust the project/.test(n)));
  assert.equal(readFileSync(p, "utf8"), PI_EXTENSION);
  const again = runSetup({ directory: d, agent: "pi" });
  assert.deepEqual([again.files[0]!.status, again.notes], ["unchanged", []]);
  writeFileSync(p, `${PI_MARKER}\nexport default function () {}\n`);
  assert.equal(runSetup({ directory: d, agent: "pi" }).files[0]!.status, "updated");
  writeFileSync(p, "export default function mine() {}\n");
  assert.throws(() => runSetup({ directory: d, agent: "pi" }), code(EXIT.usage));
  const home = tmp();
  assert.deepEqual(runSetup({ directory: d, agent: "pi", user: true, home }).files.map((f) => f.path),
    [join(home, ".pi", "agent", "extensions", "todopi.ts")]);
});

test("pi 扩展：session_start / session_compact 跑 prime（--session 取自 sessionManager）并缓存，before_agent_start 追加系统提示；失败不缓存", async () => {
  const { PI_EXTENSION } = await import("../../src/format/pi-extension.ts");
  const dir = tmp();
  const file = join(dir, "ext.mjs");
  writeFileSync(file, PI_EXTENSION);
  const { default: factory } = await import(file);
  const handlers = new Map<string, (e: unknown, ctx: unknown) => Promise<unknown>>();
  const calls: string[][] = [];
  let code = 0;
  let n = 0;
  const pi = {
    on: (name: string, fn: (e: unknown, ctx: unknown) => Promise<unknown>) => handlers.set(name, fn),
    exec: async (cmd: string, args: string[]) => { calls.push([cmd, ...args]); return { code, stdout: `## tp-aaaaaa: call ${++n}\n`, stderr: "" }; },
  };
  factory(pi);
  const ctx = (id: string) => ({ cwd: dir, sessionManager: { getSessionId: () => id } });
  const turn = async (id: string) => handlers.get("before_agent_start")!({ systemPrompt: "BASE" }, ctx(id));
  await handlers.get("session_start")!({ reason: "startup" }, ctx("s1"));
  assert.deepEqual(calls, [["todopi", "prime", "--hook", "--session", "s1"]]);
  assert.deepEqual(await turn("s1"), { systemPrompt: "BASE\n\n## tp-aaaaaa: call 1" });
  assert.deepEqual(await turn("s1"), { systemPrompt: "BASE\n\n## tp-aaaaaa: call 1" }, "缓存：不是每一轮都跑 prime");
  await handlers.get("session_compact")!({ reason: "manual" }, ctx("s1"));
  assert.deepEqual(await turn("s1"), { systemPrompt: "BASE\n\n## tp-aaaaaa: call 2" }, "压缩后刷新");
  code = 127;
  assert.equal(await turn("s2"), undefined, "prime 失败：不注入");
  code = 0;
  assert.deepEqual(await turn("s2"), { systemPrompt: "BASE\n\n## tp-aaaaaa: call 4" }, "失败不缓存，下一轮重试");
});

test("pi / opencode：没有账本时的空结果只在同一会话里出现 .todopi/ 后才重跑，不每轮都跑（F16 评审）", async () => {
  const { PI_EXTENSION } = await import("../../src/format/pi-extension.ts");
  const { OPENCODE_PLUGIN } = await import("../../src/format/opencode-plugin.ts");
  // pi
  {
    const dir = tmp();
    const file = join(dir, "ext.mjs");
    writeFileSync(file, PI_EXTENSION);
    const { default: factory } = await import(file);
    const handlers = new Map<string, (e: unknown, ctx: unknown) => Promise<unknown>>();
    let calls = 0;
    const pi = {
      on: (n: string, fn: (e: unknown, ctx: unknown) => Promise<unknown>) => handlers.set(n, fn),
      exec: async () => { calls++; return { code: 0, stdout: existsSync(join(dir, ".todopi")) ? "## tp-aaaaaa: now\n" : "", stderr: "" }; },
    };
    factory(pi);
    const ctx = { cwd: dir, sessionManager: { getSessionId: () => "s1" } };
    await handlers.get("session_start")!({}, ctx);
    assert.equal(await handlers.get("before_agent_start")!({ systemPrompt: "B" }, ctx), undefined);
    assert.equal(calls, 1, "没有账本：不每轮都重跑");
    mkdirSync(join(dir, ".todopi"));
    assert.deepEqual(await handlers.get("before_agent_start")!({ systemPrompt: "B" }, ctx), { systemPrompt: "B\n\n## tp-aaaaaa: now" });
    assert.equal(calls, 2);
  }
  // opencode
  {
    const dir = tmp();
    const file = join(dir, "plugin.mjs");
    writeFileSync(file, OPENCODE_PLUGIN);
    const { TodopiPlugin } = await import(file);
    let calls = 0;
    const $ = () => {
      calls++;
      const out = { exitCode: 0, stdout: Buffer.from(existsSync(join(dir, ".todopi")) ? "## tp-aaaaaa: now\n" : "") };
      const chain = { cwd: () => chain, quiet: () => chain, nothrow: () => Promise.resolve(out) };
      return chain;
    };
    const hooks = await TodopiPlugin({ $, directory: dir });
    await hooks.event({ event: { type: "session.created", properties: { info: { id: "s1" } } } });
    const o1 = { system: ["B"] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, o1);
    assert.deepEqual([o1.system, calls], [["B"], 1]);
    mkdirSync(join(dir, ".todopi"));
    const o2 = { system: ["B"] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, o2);
    assert.deepEqual([o2.system, calls], [["B", "## tp-aaaaaa: now"], 2]);
  }
});

test("项目级：路径上的目录是指向项目外的符号链接时拒绝（不越过显示的项目路径写入）；--user 不查（F16 评审）", () => {
  for (const [agent, dirName] of [["pi", ".pi"], ["opencode", ".opencode"], ["claude", ".claude"], ["codex", ".codex"]] as const) {
    const d = repo();
    const outside = tmp();
    symlinkSync(outside, join(d, dirName));
    assert.throws(() => runSetup({ directory: d, agent }), (e: unknown) => code(EXIT.usage)(e) && /outside the project/.test((e as Error).message), agent);
    assert.deepEqual(readdirSync(outside), [], `${agent}：项目外的目录里什么都没写`);
  }
  // 指向项目内的链接照常。
  const d = repo();
  mkdirSync(join(d, "real-pi"));
  symlinkSync(join(d, "real-pi"), join(d, ".pi"));
  assert.equal(runSetup({ directory: d, agent: "pi" }).files[0]!.status, "created");
  // --user：home 下的配置目录是符号链接也照常。
  const home = tmp();
  const elsewhere = tmp();
  symlinkSync(elsewhere, join(home, ".pi"));
  assert.equal(runSetup({ directory: d, agent: "pi", user: true, home }).files[0]!.status, "created");
});
