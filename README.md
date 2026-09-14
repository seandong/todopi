# todopi

A durable task ledger for AI coding agents.

Your agent's tasks, in your repo, in 12 fields. Survives compaction, sessions, and switching agents.

Status: pre-alpha. Product definition is complete; implementation has not started.

## What it is

`todopi` (alias `tp`) is a single CLI that keeps a dependency-aware task graph as plain Markdown files under `.todopi/` in your repository. Any coding agent — Claude Code, Codex CLI, OpenCode, pi, Cursor, Gemini CLI — reads the same ledger, so work survives context compaction, new sessions, other machines, and agent switches. A task cannot be closed as done while its verification command fails.

No daemon, no server, no database, no API key, no telemetry, no automatic git.

## Documents

| Document | Purpose |
|---|---|
| [`spec/todopi-format-v1.md`](spec/todopi-format-v1.md) | The on-disk format. Normative. Third parties can implement it without this CLI. |
| [`docs/product/todopi-prd.md`](docs/product/todopi-prd.md) | Product requirements (English) |
| [`docs/product/todopi-prd.zh-CN.md`](docs/product/todopi-prd.zh-CN.md) | 产品需求文档（中文） |
| [`docs/product/2026-09-14-todopi-agent-task-ledger-brainstorm.md`](docs/product/2026-09-14-todopi-agent-task-ledger-brainstorm.md) | Research, competitive landscape, and the 30-decision log (Chinese) |

## Name

"todopi" comes from the Chinese 土豆皮 (tǔdòupí, "potato skin"). Pronounce it "toh-doh-pee". It is unrelated to the pi coding agent or to Raspberry Pi.

## License

MIT
