# todopi

A task ledger for AI coding agents. Each task is a Markdown file in your repository, so another session or agent can pick up where work stopped.

[Website](https://todopi.com/) · [简体中文](README.zh-CN.md) · [Changelog](CHANGELOG.md)

**Version 0.2.1.** The on-disk format is version 1: [format specification](spec/todopi-format-v1.md).

## Install

With Node.js 20 or newer:

```sh
npm install --global todopi
command -v todopi
todopi --version
```

Requires Node.js 20 or newer. [Get Node.js](https://nodejs.org/en/download) if you need it.

Check `command -v todopi` in the environment your coding agent uses. An older binary earlier on `PATH` can hide the new npm installation; restart the agent after changing `PATH`.

## Start in a repository

```sh
cd /path/to/your-repo
todopi init --setup claude
todopi doctor
```

Replace `claude` with `codex`, `opencode`, `pi`, `cursor`, or `gemini` for another agent. You can connect more than one with `--setup claude,codex`. Review the generated project files and any hook trust prompt before using them, then commit those project files. By default, setup writes to the project; this command does not change your personal agent configuration.

Tell your agent what you want done. It can create a task with acceptance criteria, claim it, record findings, and close it. To inspect the same ledger yourself:

```sh
todopi ls --ready
todopi prime
```

Tasks live under `.todopi/tasks/` and can depend on one another. To inspect a specific task, run `todopi show` followed by its ID from `todopi ls --ready`. If a task has a `verify` command, `todopi done` runs it before closing; an override requires `--force --reason` and is recorded as unverified. Inspect the command before trusting it: todopi asks for confirmation on first run in a terminal. In a non-interactive agent session, after reviewing the command, explicitly run `todopi done TASK_ID --yes` with the real task ID to approve it; otherwise untrusted verification is refused.

## Boundaries and documentation

todopi itself does not upload tasks or send telemetry. It does not commit or push for you. Its optional `todopi web` board listens only on local loopback while it runs; a task's user-configured `verify` command may access the network. Repository checks cover known source patterns, not every possible form of network access.

Integrations for six agents are implemented. Cursor Agent CLI session start, rule loading, actual `/summarize`, and the JSON session-end hook have been verified in an isolated project. Cursor IDE chat and its hooks still need real-world verification. If you installed Cursor project hooks with an earlier todopi version, run `todopi setup cursor` again after upgrading to update the standard session-end command; review any warning about customized old hooks.

[Agent setup and CLI details](docs/getting-started.md) · [Task format](spec/todopi-format-v1.md) · [Command JSON output](docs/json.md) · [Agent development guide](AGENTS.md) · [MIT license](LICENSE)
