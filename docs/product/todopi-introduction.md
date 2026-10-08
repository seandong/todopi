# 把任务留在代码仓库里：认识 todopi

AI coding agent 可以很快读懂一段代码，却未必记得上一个会话做到哪里。上下文压缩、切换工具、换一台机器，都会让“刚才决定了什么、哪个任务已经验证、下一步该做什么”重新变成口头交接。

**todopi 是给 AI coding agent 使用的持久任务账本。** 它把任务放在项目的 `.todopi/` 目录中：一个任务对应一个 Markdown 文件，记录状态、依赖、验收标准、验证命令和工作日志。文件随代码一起审阅和提交；接手的人或 agent 不必依赖上一段聊天记录，就能从仓库里找到当前工作。

## 一个任务如何完成

日常回路很短：用 `todopi ls --ready` 找可做的任务，用 `todopi claim <id>` 认领，工作中用 `todopi note <id> "..."` 记下发现，逐条核实后用 `todopi check <id> <n>` 勾选验收标准，最后运行 `todopi done <id>`。

如果任务设了 `verify`，`done` 会执行这条命令；未设置也能关闭任务，但那不代表自动验证通过。验证失败时，任务不会被当作正常完成；确实需要越过验证时，必须用 `--force --reason` 留下理由，并在任务列表中标明未经验证。仓库尚未信任该类验证时，交互终端会请求确认；非交互环境若未显式批准则拒绝执行。审阅任务中的命令后，可以运行 `todopi done <id> --yes` 批准一次；`CI=true` 也会跳过询问。

例如，要修复登录页错误提示，可以用 `todopi add "修复登录页错误提示" --ac "无效输入时错误提示可见" --verify "npm test"` 建任务；其中 `npm test` 应换成项目实际可运行的测试命令。做完改动后，先核实并勾选标准，再让 `done` 执行测试。这样，任务的“完成”有一条可以重跑的依据。

## 跨会话、跨工具交接

todopi 可以接入 Claude Code、Codex CLI、OpenCode、pi、Cursor 和 Gemini CLI。`todopi prime` 提供当前任务与队列摘要，`todopi handoff` 帮助结束会话时交接；项目里的协议提醒 agent 在认领、发现新工作、记录经验和完成任务时使用账本。一个任务可以从某次会话开始，在上下文压缩后继续，或由另一个 agent 接手，而任务文件仍是共同依据。

账本使用公开的磁盘格式版本 1。它是普通文件，可以在 diff 中审阅，并跟代码一起提交。todopi 不替用户自动执行 Git 提交或推送，也没有跨仓库的统一任务视图：每个项目维护自己的账本。

## 从已有项目开始

有 Node.js 20 或更新版本时，可以通过 npm 安装：

```sh
npm install --global todopi@0.2.0
command -v todopi
todopi --version
cd /path/to/existing-project
todopi init --setup claude
todopi doctor
```

在 Git 仓库内，`init` 会定位到仓库根目录创建 `.todopi/`，并把带标记的协议段写进 `AGENTS.md`；在非 Git 目录运行时，则在指定目录建账本。`--setup claude` 会在项目的 `.claude/settings.json` 添加会话钩子以注入任务摘要，并让 `CLAUDE.md` 引用 `AGENTS.md`，使 Claude Code 读到协议。也可以把 `claude` 换成 `codex`、`opencode`、`pi`、`cursor` 或 `gemini`，或者使用 `--setup claude,codex` 接入多种 agent。先审阅生成的 `AGENTS.md`、`CLAUDE.md` 和设置文件及其与项目原有指令的关系，再把它们提交进仓库。钩子通过 PATH 查找 `todopi`，所以也要在 agent 实际使用的环境检查 `command -v todopi` 和版本，避免旧的安装遮蔽新版。

接下来选一个能够独立验收的小任务，写清验收标准和该项目真实可运行的 `verify` 命令，亲自走完从认领到完成的回路。已有 Markdown 勾选计划可以用 `todopi import <plan.md>` 导入；无需一次性搬入全部待办。

## 小而明确的边界

todopi 不需要数据库、API key、常驻进程或遥测；它自身不向外部服务发请求。可选的本地看板 `todopi web` 是前台进程，只绑定 `127.0.0.1`；任务的 `verify` 命令由项目指定，可能执行自己的网络操作。任务仍属于你的项目，如何审阅、合并和发布仍由项目自己的流程决定。

0.2.0 提供了更清晰的终端输出，以及 `todopi init --setup <agent>` 一步接入。产品仍在早期；上面的 npm 命令是当前已验证的安装方式。
