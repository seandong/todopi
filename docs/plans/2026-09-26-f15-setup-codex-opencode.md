# F15 `setup codex / opencode` 实现计划

**任务：** `tp-thtkze`（旧 F15）。**Spec:** PRD FR-A1、FR-A2；D035、D036；PRD §17（2026-09-26 实测）。

## 先实测外部事实

两家都在本机装了（Codex 0.157.1、OpenCode 1.18.15），在临时仓库里用记录载荷的 shim 实测，结论写进 PRD §17：
- **Codex** 与 Claude Code 同构，但压缩后 PostCompact 与 SessionStart(compact) **都**触发——只装 SessionStart（不设
  matcher）与 SessionEnd，否则注入两遍；标记法验证只装 SessionStart 时压缩后照样注入。项目级钩子要在 Codex 里信任。
- **OpenCode** 的 `event` 钩子不能注入；插件在 created / compacted 时跑 prime、按会话缓存，经
  `experimental.chat.system.transform` 追加进系统提示。会话开始注入已实测；压缩后注入受凭据所限没能实测。

## 组成

- Codex：复用 Claude 的合并逻辑（`ensureHookConfig`，D035 的判据），写 `.codex/hooks.json`（`--user`：`~/.codex/hooks.json`），
  改了就提示「下次启动时信任钩子」。
- OpenCode：生成 `.opencode/plugins/todopi.js`（`--user`：`~/.config/opencode/plugins/`），带标记头；已有且带标记就整份替换，
  不带标记是用户的文件，拒绝。
- 两家都原生读 AGENTS.md，不做 CLAUDE.md 那一步。
