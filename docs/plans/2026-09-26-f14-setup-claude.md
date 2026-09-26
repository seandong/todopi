# F14 `setup claude` 实现计划

**任务：** `tp-wnrlpw`（旧 F14）。**Spec:** PRD FR-A1、FR-A2、FR-Q5a、FR-P1b；D032；PRD §17（2026-09-26 重核）。

## 先核实外部事实

- 钩子格式、事件、载荷以官方 hooks 文档为准（一个查文档的子 agent 报「PostCompact 不存在」，直接查页面
  发现它错了）。`PostCompact` 存在，但不在「stdout 进上下文」的事件表里；`SessionStart` 在压缩后以 `compact`
  来源再触发，stdout 进上下文——压缩后注入走它。验收标准第 4 条据此改写（Log 里有说明）。

## 组成

- `prime --hook` / `handoff --hook`：会话 id 从 stdin 的 JSON 取（`session_id` / `sessionID` / `sessionId`），
  取不到退回 actor；没有 `.todopi/` 静默退出 0（用户级钩子在每个项目里触发）。D032 当时留给 setup 的那一步。
- `format/claude-settings.ts`：合并 `SessionStart → todopi prime --hook`、`SessionEnd → todopi handoff --check --hook`；
  别的键与钩子原样保留；已装过不再加；不是合法 JSON 对象就拒绝、不覆盖。
- `format/claude-md.ts`：CLAUDE.md 缺 `@AGENTS.md` 这一行就追加，原文不动。
- `setup claude [--user]`：项目级写项目根（`.todopi/` 所在目录）；`--user` 写 `~/.claude/settings.json`，在项目里
  照样确保项目的 CLAUDE.md。

## 验证

单元用例与突变；e2e 用 PATH 上的 shim 照 settings.json 里写的命令喂载荷去跑；真 agent 的实测记在 PRD §17。
