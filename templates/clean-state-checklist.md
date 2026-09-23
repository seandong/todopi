# 清洁态检查清单

一个 session 在五个维度全部满足前，不算结束。`make clean-check` 自动检查其中四项，
第五项（diff 聚焦）需要人或 agent 自己判断。

## 1. 基线是绿的

`make check` 的 `overall` 为 `pass`。`blocked` 不算通过——如果某层跑不了，
在 PROGRESS.md 的 Blockers 里写清缺什么、下一步装什么。

## 2. 没有 debug artifact

- `src/` 与 `tests/` 里没有 `console.log` / `console.debug` 残留
- 任何地方都没有 `debugger` / `.only(` / `.skip(`
- 没有被注释掉的测试或断言
- 没有 `.orig` / `.rej` / `*.tmp` / 临时脚本留在工作区

`tools/` 与 `scripts/` 不查 `console.log`：那里放的是 harness 自己的命令行脚本，
打印报告是它们的职责。把正当输出算成残留，只会逼人用 `process.stdout.write` 绕开，
规则就退化成仪式。

## 3. 状态文件已更新

- `PROGRESS.md` 的 Current State 反映本次工作所基于的 commit 与 `make check` 结果。
  `Last commit:` 写的是**写这行时的 HEAD**，提交后它自然成为新 HEAD 的祖先——
  不要试图让它等于自己所在的那个 commit，那个条件永远无法满足
- `PROGRESS.md` 的 Next Steps 是下一个 session 可直接执行的动作，不是「继续做」
- 有任务完成时，`.todopi/tasks/<id>.md` 的 `status` 与 Log 由 `todopi done`
  写入，不是手工改的
- 有新决策时，`DECISIONS.md` 已追加条目

## 4. startup 路径可用

一个刚 clone 仓库的人（或 agent）按 `AGENTS.md` 的 clock-in 步骤走一遍，
每条命令都存在且能跑。特别是：新增了依赖或工具后，`make doctor` 要能检出缺失
并给出安装命令，而不是让下一个 session 撞上一个看不懂的报错。

## 5. diff 是聚焦的

`git diff` 里的每一个文件都能回答「它为什么必须为这个 feature 而改」。
顺手的格式化、无关的重命名、预留的配置项都应该移出这次改动——它们会淹没 diff，
让评审失去意义。

---

跑 `make clean-check` 检查 1–4 项。第 5 项自己看 `git diff`。
