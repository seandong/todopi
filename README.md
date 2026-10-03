# todopi

A durable task ledger for AI coding agents.

Your agent's tasks, in your repo, in 12 fields. Survives compaction, sessions, and switching agents.

Status: 0.2.0. Expect rough edges in the CLI; the on-disk format is versioned (format version 1) and specified in [`spec/`](spec/todopi-format-v1.md). Changes are listed in [`CHANGELOG.md`](CHANGELOG.md).

## What it is

`todopi` (alias `tp`) is a single CLI that keeps a dependency-aware task graph as plain Markdown files under `.todopi/` in your repository. Any coding agent — Claude Code, Codex CLI, OpenCode, pi, Cursor, Gemini CLI — reads the same ledger, so work survives context compaction, new sessions, other machines, and agent switches. `todopi done` runs the task's `verify` command and refuses to close the task while it fails; the only way past it is `--force --reason`, which is recorded in the task's Log for good and marks the task as unverified in every listing.

No resident process, no database, no API key, no telemetry, no network access, no automatic git. The optional local board (`todopi web`) is a foreground process bound to 127.0.0.1 that exits with your terminal.

That is not a promise, it is a build rule: a check in this repository's CI rejects any outbound network call reaching `src/`, so a release that phoned home could not be produced without first deleting the rule in a visible commit. The one place todopi executes anything is your own `verify` command, and it prints that command before running it.

Installing with npm adds about 2.3 MB of files: todopi's own JavaScript (about 460 KB) and four dependencies — `yaml`, `commander`, `fractional-indexing`, and `commonmark`, which brings three small packages of its own. It is plain JavaScript on Node 20 or newer; the single-file binary is there for machines without Node, not as the default path.

## Install

With Node.js 20 or newer, install the public npm package:

```sh
npm install --global todopi
```

The GitHub repository is currently private. Its raw `install.sh` URL and GitHub Release binary assets return 404 without authenticated access; ordinary `curl` does not use your browser or git credentials. The npm command above is the public installation path. Binaries exist for macOS and Linux on x64 and arm64 and are attached to each GitHub Release, but require authenticated access while the repository is private. The installer script and its binary fallback will become available through the public raw URL if the repository is made public. Homebrew (`brew install seandong/tap/todopi`) also needs a live tap **and publicly downloadable Release assets**; the private repository currently prevents an unauthenticated brew install.

**`todopi` must be on the PATH your coding agent sees.** Every hook below runs `todopi` by name. After installing with npm, run `command -v todopi` and `todopi --version` in the environment your agent uses. If you previously installed a binary in `~/.local/bin`, make sure that older copy does not appear ahead of the npm installation on PATH. Restart the agent after changing PATH.

Then, in a repository:

```sh
todopi init            # creates .todopi/ and adds the protocol to AGENTS.md
todopi setup claude    # or codex, opencode, pi, cursor, gemini — one per agent you use
```

Or both in one step: `todopi init --setup claude` (repeat `--setup`, or separate agents with commas: `--setup claude,codex`).

`setup` writes project-level files by default, so a teammate who clones the repository gets the same hooks. Add `--user` to put the hooks (or the OpenCode plugin, or the pi extension) in your home directory instead, for every repository. Two pieces stay per project even with `--user`, because they belong to the repository: Claude Code's `CLAUDE.md` import and Cursor's rule file. Run from inside a repository, `setup claude --user` and `setup cursor --user` still write those there; Cursor's user-level rules are set in its settings, not in a file. Running `setup` again is safe: in a shared settings file it only updates its own entries; the files it owns outright (the OpenCode plugin, the pi extension, the Cursor rule) it regenerates. Commit what it writes.

## Setting up each agent

Every agent gets the same thing: at the start of a session it is handed `todopi prime` — the tasks it holds and a pointer to the rest — and the protocol (below) tells it when to claim, note, and close. What differs is how each agent lets that in, and whether it can be re-injected after the agent compacts its context.

### Claude Code

```sh
todopi setup claude
```

Writes `SessionStart` and `SessionEnd` hooks to `.claude/settings.json`, and makes sure `CLAUDE.md` imports `AGENTS.md` (`@AGENTS.md`) — Claude Code reads `CLAUDE.md`, not `AGENTS.md`. `SessionStart` fires again after a compaction, so the ledger comes back on its own.

### Codex CLI

```sh
todopi setup codex
```

Writes `SessionStart` and `SessionEnd` hooks to `.codex/hooks.json`. **Codex runs new or changed hooks only after you trust them**: on its next start, choose to trust the hooks (or review them with `/hooks`). Until then nothing is injected. `SessionStart` fires again after a compaction. Codex reads `AGENTS.md` on its own.

### OpenCode

```sh
todopi setup opencode
```

Writes a plugin to `.opencode/plugins/todopi.js`. It puts `todopi prime` into the system prompt when a session is created and refreshes it after each compaction. OpenCode reads `AGENTS.md` on its own.

### pi

```sh
todopi setup pi
```

Writes an extension to `.pi/extensions/todopi.ts`. It adds `todopi prime` to the system prompt at session start and refreshes it after each compaction. **pi loads project-local extensions only after you trust the project**: accept the trust prompt on its next start. pi reads `AGENTS.md` on its own.

### Cursor

```sh
todopi setup cursor
```

Writes `sessionStart` and `sessionEnd` hooks to `.cursor/hooks.json` and an always-applied rule to `.cursor/rules/todopi.mdc`. Cursor has no hook that runs after a compaction, so the rule — which stays in context — tells the agent to run `todopi prime` itself when it notices its context was summarized. Cursor's hook support in its CLI (`cursor-agent`) has been changing; the rule file is also the fallback when a hook does not fire. Cursor reads `AGENTS.md` on its own.

### Gemini CLI

```sh
todopi setup gemini
```

Writes hooks to `.gemini/settings.json` and adds `AGENTS.md` to `context.fileName`, so the protocol is part of the system instructions and survives compression. Gemini CLI has no hook after compression: after a manual `/compress`, todopi marks the session and re-injects `todopi prime` into the next turn. After an automatic compression it relies on the protocol line telling the agent to run `todopi prime` itself.

## The protocol

`todopi init` writes a short section (about 400 tokens) into `AGENTS.md`, between `<!-- todopi:protocol:begin -->` and `<!-- todopi:protocol:end -->`; running `init` again replaces it in place. It tells the agent what a task is (one change worth a commit, not a step), to claim before touching code, to add discovered work with `--from`, to note what it learned the hard way, to finish with `todopi done`, to run `todopi handoff` at the end of a session, and to run `todopi prime` whenever it notices its context was compacted. The text is in [`src/protocol.ts`](src/protocol.ts).

## Everyday commands

| | |
|---|---|
| `todopi add "<title>" --ac "<criterion>"` | create a task with acceptance criteria |
| `todopi ls --ready` | what can be picked up next, in queue order |
| `todopi claim <id>` | take a task |
| `todopi note <id> "<text>"` | append to its Log |
| `todopi check <id> <n>` | tick acceptance criterion *n* |
| `todopi done <id>` | run `verify`, check the gates, close it |
| `todopi show <id>` | everything about one task |
| `todopi prime` | what you are working on, within a token budget |
| `todopi web` | a read-only board on 127.0.0.1 |

`todopi --help` lists all 20 subcommands. Every command that reports something takes `--json`; its output is a documented contract ([`docs/json.md`](docs/json.md)) that only changes incompatibly with a major version.

In a terminal the output is colored, and `ls` has a header and a summary line. Piped, run by a coding agent, or with `--json`, it is plain text with no escape codes and one line per result, so `todopi ls | wc -l` counts tasks; messages such as "No tasks match." go to stderr instead. `NO_COLOR` turns the colors off; `FORCE_COLOR=1` turns them on in a pipe without changing the lines (never for a coding agent or `--json`).

Several repositories: todopi keeps one ledger per repository and has no cross-repository view yet. A shell loop covers it:

```sh
for d in ~/code/*/; do todopi -C "$d" ls --ready 2>/dev/null | sed "s|^|$(basename "$d")  |"; done
```

## A note on `verify`

`todopi done` runs the task's own `verify` command from your repository. Two things follow. Allowing `todopi` in a coding agent's command allowlist is **not** a sandbox: the agent's permission check sees `todopi done`, not the command that runs underneath it. And `verify` is an ordinary field in a task file, so it can change — by a hand edit, by an agent, or by a pull request you merge. todopi asks before the first run in a repository (in a terminal; without one it refuses until you pass `--yes`), prints the command verbatim before every run, and `todopi handoff` lists tasks whose `verify` changed since the session's last `todopi prime`. If you rely on an allowlist for isolation, pair it with an OS-level sandbox.

## todopi and Beads

[Beads](https://github.com/steveyegge/beads) (`bd`) showed that coding agents need a task graph in the repository, and todopi keeps its best ideas: a ready queue, claiming, `prime`, dependencies between tasks. The difference is in what the ledger is. Beads keeps tasks in a Dolt SQL database — embedded by default, or a `dolt sql-server` for several writers — and its `issues.jsonl` is an export, not the source of truth. In todopi the files are the ledger: one Markdown file per task, twelve fields, a public [format specification](spec/todopi-format-v1.md) — you read a task in a diff, review it in a pull request, and merge it with git like any other file. todopi is also deliberately small — 20 subcommands — and `done` runs each task's own verification: closing past a failing check is possible, but it is recorded in the task and shown as unverified. Coming from Beads Classic: `todopi import beads` reads `.beads/issues.jsonl` and keeps each Beads id in `external.beads.id`.

## Documents

| Document | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Start here to work in this repository. Operating manual for coding agents; links to the harness docs under [`docs/harness/`](docs/harness/index.md). |
| [`spec/todopi-format-v1.md`](spec/todopi-format-v1.md) | The on-disk format. Normative. Third parties can implement it without this CLI. |
| [`spec/fixtures/`](spec/fixtures/README.md) | The format as executable test data — sample files with expected parses. Run it against your own implementation. |
| [`spec/IMPLEMENTING.md`](spec/IMPLEMENTING.md) | Advisory notes for implementing the format: what actually goes wrong, and in what order to build. |
| [`docs/json.md`](docs/json.md) | The `--json` output of every command, and its compatibility promise. |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed in each release. |
| [`docs/product/todopi-prd.md`](docs/product/todopi-prd.md) | Product requirements (Chinese; an internal design document) |
| [`docs/product/2026-09-14-todopi-agent-task-ledger-brainstorm.md`](docs/product/2026-09-14-todopi-agent-task-ledger-brainstorm.md) | Research, competitive landscape, and the 30-decision log (Chinese) |

## Name

"todopi" comes from the Chinese 土豆皮 (tǔdòupí, "potato skin"). Pronounce it "toh-doh-pee". It is unrelated to the pi coding agent or to Raspberry Pi.

## License

MIT
