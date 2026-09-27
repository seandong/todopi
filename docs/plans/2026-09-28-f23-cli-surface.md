# F23 CLI 表面补齐 实现计划

**任务：** `tp-n7r8ph`。**Spec:** PRD FR-Q4、FR-D5、§8（命令参考与全局参数）；v0.1 缺口审计（docs/plans/2026-09-28-v01-gap-audit-*.md）。

1. FR-Q4 别名：`ls|list`、`add|new|create`、`note|log`、`dep|block`（commander 的 alias）。
2. `close --reason` 不用 `--force`：TransitionShape 加 `reasonWithoutForce`，只有 close 打开；理由写进 closed 那一行的文字；空理由拒绝；
   `done` 仍只在强制时收理由。
3. `--quiet`：setup 的提示、import / import beads 的 Next、web 的 Ctrl+C 提示不输出；结果（文件状态、导入结果、地址）保留。
4. done 被拒时的验收标准出路：每条没勾的一条 `todopi check <id> <n>`，不再叫人改任务文件（协议：Never edit those files by hand）。
5. `tools/e2e/f23-cli-surface.sh`：别名、close --reason、照着报告的 check 命令勾完能 done、三处 --quiet。
