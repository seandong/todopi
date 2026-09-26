# todopi

A durable task ledger for AI coding agents.

Your agent's tasks, in your repo, in 12 fields. Survives compaction, sessions, and switching agents.

Status: pre-alpha. The CLI works end to end; it has not been released yet.

## What it is

`todopi` (alias `tp`) is a single CLI that keeps a dependency-aware task graph as plain Markdown files under `.todopi/` in your repository. Any coding agent — Claude Code, Codex CLI, OpenCode, pi, Cursor, Gemini CLI — reads the same ledger, so work survives context compaction, new sessions, other machines, and agent switches. A task cannot be closed as done while its verification command fails.

No resident process, no database, no API key, no telemetry, no network access, no automatic git. The optional local board (`todopi web`) is a foreground process bound to 127.0.0.1 that exits with your terminal.

That is not a promise, it is a build rule: a check in this repository's CI rejects any outbound network call reaching `src/`, so a release that phoned home could not be produced without first deleting the rule in a visible commit. The one place todopi executes anything is your own `verify` command, and it prints that command before running it.

Installing with npm pulls about 3.3 MB: todopi (about 430 KB of JavaScript) and four dependencies — `yaml`, `commander`, `fractional-indexing`, and `commonmark`, which brings three small packages of its own. It is plain JavaScript on Node 20 or newer; the single-file binary is there for machines without Node, not as the default path.

## Install

Once the first version is released:

```sh
curl -fsSL https://raw.githubusercontent.com/seandong/todopi/main/install.sh | sh
```

With Node.js 20 or newer on your PATH, this installs the npm package; without it, it downloads the binary for your platform and verifies its SHA-256 before installing. Either way the command lands in `~/.local/bin`. Set `TODOPI_VERSION` to install a specific version. With Node you can also run `npm install --global todopi`.

Then, in a repository: `todopi init`, and `todopi setup <agent>` for the coding agents you use.

## A note on `verify`

`todopi done` runs the task's own `verify` command from your repository. Two things follow. Allowing `todopi` in a coding agent's command allowlist is **not** a sandbox: the agent's permission check sees `todopi done`, not the command that runs underneath it. And `verify` is an ordinary field in a task file, so it can change — by a hand edit, by an agent, or by a pull request you merge. todopi asks before the first run in a repository, prints the command verbatim before every run, and flags tasks whose `verify` changed. If you rely on an allowlist for isolation, pair it with an OS-level sandbox.

## Documents

| Document | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Start here to work in this repository. Operating manual for coding agents; links to the harness docs under [`docs/harness/`](docs/harness/index.md). |
| [`spec/todopi-format-v1.md`](spec/todopi-format-v1.md) | The on-disk format. Normative. Third parties can implement it without this CLI. |
| [`spec/fixtures/`](spec/fixtures/README.md) | The format as executable test data — sample files with expected parses. Run it against your own implementation. |
| [`spec/IMPLEMENTING.md`](spec/IMPLEMENTING.md) | Advisory notes for implementing the format: what actually goes wrong, and in what order to build. |
| [`docs/product/todopi-prd.md`](docs/product/todopi-prd.md) | Product requirements (Chinese; an internal design document) |
| [`docs/product/2026-09-14-todopi-agent-task-ledger-brainstorm.md`](docs/product/2026-09-14-todopi-agent-task-ledger-brainstorm.md) | Research, competitive landscape, and the 30-decision log (Chinese) |

## Name

"todopi" comes from the Chinese 土豆皮 (tǔdòupí, "potato skin"). Pronounce it "toh-doh-pee". It is unrelated to the pi coding agent or to Raspberry Pi.

## License

MIT
