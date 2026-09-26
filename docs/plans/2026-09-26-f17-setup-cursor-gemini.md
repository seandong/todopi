# F17 `setup cursor / gemini` 实现计划

**任务：** `tp-yuka3e`（旧 F17）。**Spec:** PRD FR-A1、FR-A2、FR-A2a（本任务改写）、FR-A2b；DECISIONS D035、D038。

## 先定下来的

- **FR-A2a 的前提不成立，改方案**（一手来源见 PRD §17）。两家的压缩前钩子都不能改摘要：
  - Cursor：会话开始 `sessionStart` → `additional_context`；压缩后没有能注入的钩子，靠 `alwaysApply: true` 的
    规则文件（同时是 FR-A2b 要的回退）。
  - Gemini：`SessionStart` 注入；`PreCompress`（matcher `manual`）只打「刚压缩过」标记，`BeforeAgent` 每轮开头取标记、
    有就注入；`context.fileName` 含 AGENTS.md，自动压缩后靠系统指令里的协议行。自动的 PreCompress 每轮都触发（不一定真
    压缩），所以不据它打标记。
- **Cursor 实机验证拆到 tp-zagvp5**：需要登录，IDE 本来就要人手工验证。

## 组成

1. `commands/hook.ts`：`wrapHookOutput(shape, text)`（`cursor` / `gemini:SessionStart` / `gemini:BeforeAgent`）、
   `compactionGate(dir, mark|take, session?, actor?)`、`directoryFromHookPayload`（Cursor 的 `workspace_roots[0]`：
   用户级钩子在 `~/.cursor/` 里运行）；会话 id 多认 `conversation_id`。
2. `format/session.ts`：`markCompacted` / `takeCompacted`——与 prime 记录同目录、同键，后缀 `.compacted`。
3. `cli.ts`：`prime --hook-json <shape>`、`--mark-compacted`、`--if-compacted`；`--hook` 在没用 `-C` 时按载荷找项目目录
   （prime 与 handoff 共用）。
4. `format/claude-settings.ts`：`HookList` 第三项是可选的 matcher（只认 matcher 恰好相等的组）；`GEMINI_HOOKS` 与
   `ensureGeminiSettings`（附带 `context.fileName`）；`CURSOR_HOOKS` 与 `ensureCursorHooks`（另一种结构，判据同 D035）。
5. `format/cursor-rule.ts`：规则文件；标记在 frontmatter 第二行，`ensureGeneratedFile` 的标记行号参数化。
6. `commands/setup.ts`：`cursor`（项目级写钩子 + 规则；`--user` 只写 `~/.cursor/hooks.json`，规则在项目里才写）、
   `gemini`（`.gemini/settings.json` / `~/.gemini/settings.json`）。
7. `tools/e2e/f17-setup-cursor-gemini.sh`：CLI 接通、JSON 形状、标记恰好消费一次、`workspace_roots`、`-C` 优先。

## 要用例钉住的不变量

- 标记：mark 之后 take 恰好一次为真；按会话隔离；没有会话 id 按 actor。空输出不包 JSON。
- Gemini：`context.fileName` 缺失→`["AGENTS.md","GEMINI.md"]`；字符串/数组补上；已含不改写法；形状不对拒绝、文件不动。
  PreCompress 只认 matcher 恰为 `manual` 的组。
- Cursor hooks.json：`version` 必须是 1；只认 `{command}`（可带正数 timeout）；别的键、别的钩子原样；权限位不变；
  非法 UTF-8（包括藏在 JSON 字符串里的）、符号链接拒绝。
- 规则文件：第二行是标记才替换，第一行是标记不算。

## 验证

Gemini 在真实运行时里：本地假 API 服务器（`GOOGLE_GEMINI_BASE_URL`）记录请求体，交互式会话里 `/compress` 前后比较
注入落在哪（PRD §17）。0.61.0 以 npm 包源码核对。
