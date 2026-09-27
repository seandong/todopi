import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_HOOKS, CODEX_HOOKS, CURSOR_HOOKS, GEMINI_HOOKS, type HookList } from "../src/format/claude-settings.ts";

/**
 * 市场 / 注册表的包（tp-lv7y3h）：仓库里的文件就是 tools/plugins/build.mjs 的输出，钩子与 `todopi setup` 装的逐条相同——
 * 同时装了两份时 prime 按同一个去重键挡掉第二份（D057），命令不同就挡不住。
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const commands = (file: string): string[] => {
  const hooks = (JSON.parse(read(file)) as { hooks: Record<string, unknown[]> }).hooks;
  return Object.entries(hooks).flatMap(([event, groups]) => groups.flatMap((g) => {
    const group = g as { command?: string; matcher?: string; hooks?: { command: string }[] };
    return group.command !== undefined ? [`${event}|${group.command}`]
      : group.hooks!.map((h) => `${event}|${h.command}|${group.matcher ?? ""}`);
  }));
};
const expected = (list: HookList, matcher = true) => list.map(([e, c, m]) => matcher ? `${e}|${c}|${m ?? ""}` : `${e}|${c}`);

test("仓库里的包与生成器的输出一致（改了钩子或版本号要重跑 node tools/plugins/build.mjs）", () => {
  const r = spawnSync(process.execPath, ["tools/plugins/build.mjs", "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("每家包里的钩子命令与 setup 写的逐条相同", () => {
  assert.deepEqual(commands("plugins/claude/hooks/hooks.json"), expected(CLAUDE_HOOKS));
  assert.deepEqual(commands("plugins/codex/hooks/hooks.json"), expected(CODEX_HOOKS));
  assert.deepEqual(commands("plugins/gemini/hooks/hooks.json"), expected(GEMINI_HOOKS));
  assert.deepEqual(commands("plugins/cursor/hooks/hooks.json"), expected(CURSOR_HOOKS, false));
});

test("OpenCode / pi 的包就是 setup 写的那份代码（只换了第一行的出处说明）", async () => {
  const { OPENCODE_PLUGIN } = await import("../src/format/opencode-plugin.ts");
  const { PI_EXTENSION } = await import("../src/format/pi-extension.ts");
  const body = (s: string) => s.slice(s.indexOf("\n") + 1);
  assert.equal(body(read("packages/opencode/index.js")), body(OPENCODE_PLUGIN));
  assert.equal(body(read("packages/pi/extensions/todopi.ts")), body(PI_EXTENSION));
});

test("三家的市场文件都在、都指向各自的插件目录；清单的名字与版本号一致", () => {
  const version = (JSON.parse(read("package.json")) as { version: string }).version;
  const market = (p: string) => JSON.parse(read(p)) as { plugins: { name: string; source: string | { path: string } }[] };
  const src = (s: string | { path: string }) => typeof s === "string" ? s : s.path;
  // Codex 找不到 .agents/ 的就退回读 .claude-plugin/ 的：三份缺一份，那一家就装上别家的钩子
  assert.equal(src(market(".claude-plugin/marketplace.json").plugins[0]!.source), "./plugins/claude");
  assert.equal(src(market(".agents/plugins/marketplace.json").plugins[0]!.source), "./plugins/codex");
  assert.equal(src(market(".cursor-plugin/marketplace.json").plugins[0]!.source), "./plugins/cursor");
  for (const p of ["plugins/claude/.claude-plugin/plugin.json", "plugins/codex/.codex-plugin/plugin.json", "plugins/cursor/.cursor-plugin/plugin.json",
    "plugins/gemini/gemini-extension.json", "packages/opencode/package.json", "packages/pi/package.json"]) {
    const m = JSON.parse(read(p)) as { name: string; version: string };
    assert.match(m.name, /^(todopi|@todopi\/(opencode|pi))$/, p);
    assert.equal(m.version, version, p);
  }
});

test("Cursor 插件的规则在没有账本的项目里不断言有账本", () => {
  const rule = read("plugins/cursor/rules/todopi.mdc");
  assert.match(rule, /^---\n[\s\S]*alwaysApply: true\n---\n/);
  assert.match(rule, /If this repository has a `\.todopi\/` directory/);
  assert.doesNotMatch(rule, /^This repository tracks work/m);
});
