# todopi

给 AI 编程 Agent 用的任务账本。每个任务都是仓库中的 Markdown 文件，换一个会话或 Agent 也能接着做。

[官网](https://todopi.com/) · [English README](README.md) · [更新记录](CHANGELOG.md)

**当前版本 0.2.1。** 磁盘格式版本为 1：[格式规格](spec/todopi-format-v1.md)。

## 安装

已有 Node.js 20 或更新版本时：

```sh
npm install --global todopi
command -v todopi
todopi --version
```

需要 Node.js 20 或更新版本；如尚未安装，可从 [Node.js 官网](https://nodejs.org/en/download)获取。

请在 Agent 实际使用的环境里核对 `command -v todopi`。如果旧二进制排在 npm 安装路径前面，可能会运行旧版；调整 `PATH` 后重启 Agent。

## 在已有仓库开始

```sh
cd /path/to/your-repo
todopi init --setup claude
todopi doctor
```

使用其他 Agent 时，把 `claude` 换成 `codex`、`opencode`、`pi`、`cursor` 或 `gemini`。可以用 `--setup claude,codex` 接入多个。先审阅生成的项目文件及钩子信任提示，再提交这些项目文件。默认 setup 只写项目配置，上面的命令不会修改你的个人 Agent 配置。

接下来直接用自然语言告诉 Agent 要做什么。它可以创建带验收标准的任务、认领工作、记录发现并关闭任务。你也可以自己查看同一份账本：

```sh
todopi ls --ready
todopi prime
```

任务文件位于 `.todopi/tasks/`，可以设置依赖。要查看单个任务，在 `todopi show` 后填写 `todopi ls --ready` 列出的实际任务 ID。如果任务配置了 `verify`，`todopi done` 会在关闭前运行该命令；`--force --reason` 的例外会被记录为未经验证。首次执行前先审阅验证命令：交互终端会请求确认；在 Agent 的非交互环境中，审阅后需显式运行 `todopi done TASK_ID --yes`（将 `TASK_ID` 换为实际 ID），否则未信任的验证会被拒绝。

## 边界与文档

todopi 自身不上传任务、不发送遥测，也不会替你提交或推送 Git。可选的 `todopi web` 只在运行时监听本机回环地址；任务自定义的 `verify` 命令可能访问网络。六种 Agent 的接入已实现；Cursor Agent CLI 的会话启动、规则加载、真实 `/summarize` 后指针与 JSON 会话结束钩子已在隔离项目实测。Cursor IDE 的真实对话与钩子仍待验证。升级后可重跑 `todopi setup cursor`，就地更新旧的标准项目级结束钩子；若提示自定义旧钩子仍在运行，请审阅该配置。

[Agent 接入与命令详情](docs/getting-started.md) · [任务格式](spec/todopi-format-v1.md) · [命令 JSON 输出](docs/json.md) · [开发指引](AGENTS.md) · [MIT 许可证](LICENSE)
