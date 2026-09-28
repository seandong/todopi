# 终端输出统一为 Cargo 风格 —— 设计稿（tp-rk6o8q）

用户定（2026-09-28）：Cargo / uv 式动词列，所有命令统一。

## 原则

1. **每个命令一份排版，颜色是唯一的区别。** 纯文本（agent 读到的、管道里的）就是去掉颜色的同一份输出，不维护两套布局。
   上色的判定仍只在 `chooseStyle`（--json、钩子、agent 在场、NO_COLOR、TERM=dumb 一律不上色）。
2. **`prime` 与 `handoff` 的排版不动。** 它们是写给 agent 上下文的（token 预算、`pointer` 是 prime 最后一行的原文，docs/json.md）。
3. 文本输出不在兼容性承诺里（docs/json.md 只管 `--json`），但测试与 e2e 里按文字断言的地方逐一改，不删断言。
4. `--quiet` 的边界不变：结果留下，提示（Next、note）去掉。

## 记号

| 元素 | 写法 | 颜色 |
|---|---|---|
| 动作行 | 动词右对齐到第 12 列，空一格接对象：`     Created .todopi/config.yml` | 动词加粗；成功绿、改动黄、无操作暗、拒绝红 |
| 任务 | `tp-1lfw9u  Write hello.sh`（id 与标题之间两个空格） | id 青色 |
| 小结 | 也是动作行：`       Ready todopi ledger in /path` | 同动作行；家目录只在上色时缩成 ~ |
| 下一步 | 标题 `Next`，下面每行 `  命令   说明`；只有顺序有意义时编号（init） | 标题加粗、命令青色、说明暗 |
| 诊断 | `error: …` `warning: …` `note: …` | error 红、warning 黄、note 加粗 |
| 状态 | 单词：`in progress` `ready` `blocked` `open` `done` `closed` | 黄、绿、暗、默认、绿、暗 |
| 表头 | `ID  STATUS  TITLE` | 暗 |

## 评审后的修订（开工前，顾问意见）

- **不用任何符号**（● ○ ◌ ✓）：●、○ 在东亚宽度里是「模糊宽度」，中文环境的终端可能按两格画，`ls` 的列就错位；Cargo 本身也只用单词加颜色。
  小结行也写成动作行，于是纯文本与上色版真正是同一份排版，没有例外。
- **add 的第一行仍以 id 打头**（`tp-x  Title`）：e2e 与 agent 用 `add … | head -1 | cut -d' ' -f1` 取 id（9 处），id 就是这条命令的结果。
- **门禁报告的说明仍单独一行**，放在命令下面：它们是整句，两栏会太长。只改节标题与第一行的 `error:`。
- **不上色的保护覆盖所有命令**：子进程测试逐个命令在 FORCE_COLOR 下跑 agent 在场与 --json 两种情形，stdout 与 stderr 都不许有 ESC。
- **一个命令一个提交**：渲染器、单测、e2e 一起改，三层全绿再提交。
- 依赖文字的断言清单（字面匹配 tests/ 与 tools/e2e/）：setup 的 `^created …`（f14–f17 共 5 处）、`^unchanged` 计数（f15–f17）、
  `Imported`（3）、`todopi board:`（4）、`No tasks match`（2）、`[unverified]`（保留，不动）、`doctor: `（1）。

## 逐命令

### init
```
     Created .todopi/config.yml
     Created .todopi/.gitignore
       Added todopi protocol to AGENTS.md
       Ready todopi ledger in /Users/me/workspace/x

Next
  1. todopi setup claude   connect your coding agent (or codex, opencode, pi, cursor, gemini)
  2. todopi add "..."      create your first task
```
已存在：`   Unchanged .todopi/config.yml (already present)`；AGENTS.md：`Added` / `Updated … section` / `Unchanged … (already current)`。

### setup
```
     Created .claude/settings.json
     Created CLAUDE.md
note: Codex runs new or changed hooks only after you trust them: …
```
路径：在项目里给相对项目根的路径，否则给绝对路径（上色时缩成 ~）。状态：Created / Updated / Appended / Unchanged。

### add
```
tp-1lfw9u  Write hello.sh

Next
  todopi claim tp-1lfw9u   start working on it
```

### ls
```
ID         STATUS          TITLE
tp-1lfw9u  in progress  Write hello.sh  [0/1]
tp-1z6pik  blocked      Publish to npm
tp-lbznnv  ready        Child task

3 tasks · 1 in progress · 1 blocked · 1 open
```
原来行内的标记（`[0/1]` 验收进度、`[unverified]` 等）保留在标题后面；「Showing N of M」并进小结行。

### show
头一行 `tp-1lfw9u  Write hello.sh`（id 青、标题加粗）；字段表不变，status 按状态上色；节标题加粗；`[x]` 绿、`[ ]` 暗；Log 的时间戳暗。

### claim / release / note / check / edit / move / dep
```
     Claimed tp-1lfw9u  Write hello.sh
   Refreshed tp-1lfw9u  Write hello.sh (already yours; lease renewed)
    Released tp-1lfw9u  Write hello.sh
       Noted tp-1lfw9u  Write hello.sh
     Checked tp-1lfw9u  #1 prints hello
   Unchecked tp-1lfw9u  #1 prints hello
      Edited tp-1lfw9u  labels
       Moved tp-1lfw9u
     Blocked tp-1z6pik  by tp-1lfw9u
   Unblocked tp-1z6pik  from tp-1lfw9u
   Unchanged tp-1lfw9u  #1 was already checked; nothing was written
```
顶掉别人的认领：`warning: took it over from alice@host; this is recorded in the task log`。release 的「anyone can claim it」是 note。

### done / close / reopen
```
   Verifying tp-1lfw9u  test "$(sh hello.sh)" = hello
    Finished tp-1lfw9u  Write hello.sh (verify passed)
      Closed tp-1lfw9u  Write hello.sh (wontfix)
    Reopened tp-1lfw9u  Write hello.sh
```
`--force`：`warning: closed with --force; the task is recorded as unverified`。

被拒（门禁报告）：
```
error: refused to done tp-1lfw9u  Write hello.sh

Acceptance criteria: 1 unchecked
  1. prints hello
     todopi check tp-1lfw9u 1                     once criterion 1 is actually met
     todopi close tp-1lfw9u --resolution wontfix  if the work is being abandoned rather than finished

Verify: the command exited 1
  test "$(sh bye.sh)" = bye
  │ sh: bye.sh: No such file or directory
     cat …/tp-2ingkp-….log                        read the full output of the verify run

Next
  todopi done tp-1lfw9u                           run this again once the items above are fixed
  todopi done tp-1lfw9u --force --reason "<why>"  override every gate; recorded as unverified
```

### doctor
```
     Checked 3 tasks, no problems found
```
有问题：
```
.todopi/tasks/tp-x.md
  error  schema/id  id does not match the file name
warning: .todopi/tasks/tp-y.md: unknown key "foo"

error: 3 tasks, 1 problem
```
`--fix`：`  Normalized .todopi/tasks/tp-x.md (key order)`，没有要改的：`   Unchanged nothing to normalize`。

### import / import beads
```
    Imported 2 tasks from plan.md
             tp-j51c2c  step one
             tp-jvdvcj  step two

Next
  todopi ls --ready   see what can be picked up
```

### web
```
     Serving todopi board at http://127.0.0.1:4747/
note: read-only; watching .todopi/ for changes. Press Ctrl+C to stop.
```

### 错误
所有 CliError 在 stderr 上加 `error: ` 前缀（stderr 是终端时上色，判定同 stdout）。
