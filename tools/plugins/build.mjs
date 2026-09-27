#!/usr/bin/env node
// tools/plugins/build.mjs —— 生成六家市场 / 注册表的包（tp-lv7y3h；首发清单 §13、FR-A4）。
//
// 用法：node tools/plugins/build.mjs          写入仓库（改了钩子或版本号之后重跑）
//       node tools/plugins/build.mjs --check  只比较：仓库里的文件与生成结果不同就列出并以 1 退出（测试用）
//
// 钩子命令、插件 / 扩展的代码都取自 `todopi setup` 用的同一份源（src/format/*）：包与 setup 装的是同一套东西，
// 两者同时装了由 prime 去重（D057）。版本号取 package.json。上架、发布是维护者的动作（docs/marketplaces.md）。
//
// 布局（一个仓库放三家的市场文件，每家一个插件目录——钩子命令各不相同）：
//   .claude-plugin/marketplace.json   → plugins/claude/
//   .agents/plugins/marketplace.json  → plugins/codex/     （Codex 找不到它时会退回读 .claude-plugin/，所以三份必须一起提交）
//   .cursor-plugin/marketplace.json   → plugins/cursor/
//   plugins/gemini/                   Gemini 扩展的清单必须在所装仓库的根：维护者把它推到单独的仓库 seandong/todopi-gemini
//   packages/opencode/                npm 包 @todopi/opencode
//   packages/pi/                      npm 包 @todopi/pi（pi package）

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAUDE_HOOKS, CODEX_HOOKS, CURSOR_HOOKS, GEMINI_HOOKS } from "../../src/format/claude-settings.ts";
import { OPENCODE_PLUGIN, PLUGIN_MARKER } from "../../src/format/opencode-plugin.ts";
import { PI_EXTENSION, PI_MARKER } from "../../src/format/pi-extension.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { version, license } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const REPO = "https://github.com/seandong/todopi";
const DESCRIPTION = "Durable task ledger for AI coding agents: injects the current todopi tasks at session start and after compaction.";
const author = { name: "seandong" };
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

// Claude Code / Codex / Gemini 的钩子文件：与 settings.json 里 setup 写的标准组同形
const hookGroups = (list) => {
  const hooks = {};
  for (const [event, command, matcher] of list) {
    const group = { hooks: [{ type: "command", command }] };
    (hooks[event] ??= []).push(matcher === undefined ? group : { matcher, ...group });
  }
  return { hooks };
};

// 插件在所有项目里都生效（不只是有账本的）：规则不能断言「这个仓库有 todopi 账本」，改成有条件的
const CURSOR_PLUGIN_RULE = `---
description: todopi task ledger pointer (from the todopi Cursor plugin)
alwaysApply: true
---
If this repository has a \`.todopi/\` directory, it tracks work in a todopi ledger; the protocol is in AGENTS.md.

- To see what you are working on, run \`todopi prime\` (the full picture: \`todopi prime --full\`).
- When you notice your context was summarized or compacted, run \`todopi prime\` before continuing — no hook will do it for you.
`;

// Gemini 扩展仓库的 README：扩展只能引用自己目录里的上下文文件，AGENTS.md 里「察觉到被压缩就跑 prime」那一行要用户自己带上
const GEMINI_README = `# todopi for Gemini CLI

Hooks that inject your current [todopi](${REPO}) tasks into Gemini CLI: at session start, and on the next turn after \`/compress\`.

1. Install the todopi CLI so \`todopi\` is on your PATH (see the [todopi README](${REPO}#readme)).
2. \`gemini extensions install https://github.com/seandong/todopi-gemini\`

In a project with a \`.todopi/\` ledger, also run \`todopi setup gemini\` once (or add \`AGENTS.md\` to \`context.fileName\` in
\`.gemini/settings.json\`). That puts the todopi protocol in Gemini's system instruction, including "when you notice your context
was compacted, run \`todopi prime\`", which covers automatic compression; the hooks alone only cover \`/compress\`. Having both
the extension and \`setup\`'s hooks is fine: todopi injects once per session start.

This repository is generated from \`plugins/gemini/\` in ${REPO}; change it there.
`;

// setup 的标记行（「重跑 setup 会替换」）对包不成立：换成出处
const fromPackage = (code, marker, pkg, source) => {
  if (!code.startsWith(`${marker}\n`)) throw new Error(`${source}: the generated file no longer starts with its marker line`);
  return `// ${pkg}: the same code \`todopi setup\` writes (${source}). Needs the todopi CLI on PATH.\n${code.slice(marker.length + 1)}`;
};

const npmPackage = (name, extra) => json({
  name, version, description: DESCRIPTION, license, type: "module",
  repository: { type: "git", url: `git+${REPO}.git`, directory: extra.directory },
  homepage: `${REPO}#readme`, ...extra.fields,
});

const files = {
  // Claude Code（claude plugin validate --strict：市场要 description，插件要 author）
  ".claude-plugin/marketplace.json": json({
    name: "todopi", description: DESCRIPTION, owner: author,
    plugins: [{ name: "todopi", source: "./plugins/claude", description: DESCRIPTION }],
  }),
  "plugins/claude/.claude-plugin/plugin.json": json({ name: "todopi", version, description: DESCRIPTION, author, homepage: REPO, license }),
  "plugins/claude/hooks/hooks.json": json(hookGroups(CLAUDE_HOOKS)),

  // Codex
  ".agents/plugins/marketplace.json": json({
    name: "todopi", interface: { displayName: "todopi" },
    plugins: [{
      name: "todopi", source: { source: "local", path: "./plugins/codex" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Productivity",
    }],
  }),
  "plugins/codex/.codex-plugin/plugin.json": json({ name: "todopi", version, description: DESCRIPTION, author, homepage: REPO, license }),
  "plugins/codex/hooks/hooks.json": json(hookGroups(CODEX_HOOKS)),

  // Cursor
  ".cursor-plugin/marketplace.json": json({
    name: "todopi", description: DESCRIPTION, owner: author,
    plugins: [{ name: "todopi", source: "./plugins/cursor", description: DESCRIPTION }],
  }),
  "plugins/cursor/.cursor-plugin/plugin.json": json({ name: "todopi", version, description: DESCRIPTION, author, homepage: REPO, license }),
  "plugins/cursor/hooks/hooks.json": json({ version: 1, hooks: Object.fromEntries(CURSOR_HOOKS.map(([event, command]) => [event, [{ command }]])) }),
  "plugins/cursor/rules/todopi.mdc": CURSOR_PLUGIN_RULE,

  // Gemini CLI（单独的仓库；这里是它的全部内容）
  "plugins/gemini/gemini-extension.json": json({ name: "todopi", version, description: DESCRIPTION }),
  "plugins/gemini/hooks/hooks.json": json(hookGroups(GEMINI_HOOKS)),
  "plugins/gemini/README.md": GEMINI_README,

  // OpenCode：包里每个导出的函数都作为插件加载
  "packages/opencode/package.json": npmPackage("@todopi/opencode", {
    directory: "packages/opencode",
    fields: { main: "index.js", exports: { ".": "./index.js" }, files: ["index.js"], keywords: ["opencode", "opencode-plugin", "todopi"] },
  }),
  "packages/opencode/index.js": fromPackage(OPENCODE_PLUGIN, PLUGIN_MARKER, "@todopi/opencode", "src/format/opencode-plugin.ts"),

  // pi：keywords 里的 pi-package 让它出现在 pi.dev/packages
  "packages/pi/package.json": npmPackage("@todopi/pi", {
    directory: "packages/pi",
    fields: { files: ["extensions/"], keywords: ["pi-package", "todopi"], pi: { extensions: ["./extensions"] } },
  }),
  "packages/pi/extensions/todopi.ts": fromPackage(PI_EXTENSION, PI_MARKER, "@todopi/pi", "src/format/pi-extension.ts"),
};

const check = process.argv.includes("--check");
const stale = [];
for (const [rel, content] of Object.entries(files)) {
  const path = join(root, rel);
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === content) continue;
  if (check) { stale.push(rel); continue; }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  process.stdout.write(`${current === null ? "created" : "updated"}  ${rel}\n`);
}
if (stale.length > 0) {
  process.stderr.write(`plugins: out of date (run node tools/plugins/build.mjs):\n${stale.map((s) => `  ${s}\n`).join("")}`);
  process.exit(1);
}
