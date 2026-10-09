# Agent setup and CLI reference

Install todopi with Node.js 20 or newer:

```sh
npm install --global todopi
```

In a repository, `todopi init --setup claude` creates the ledger and connects Claude Code. Replace `claude` with the coding agent you use; run `todopi setup <agent>` to connect another agent later. Project setup creates files you can review and commit. The help command lists all 20 subcommands: `todopi --help`.

## Setting up each agent

`setup` writes project-level files by default. The integrations use `todopi prime` to show current work at session start. A rule or protocol prompts the agent to run it again when context is lost.

### Claude Code

```sh
todopi setup claude
```

Writes `SessionStart` and `SessionEnd` hooks to `.claude/settings.json`. The `CLAUDE.md` import loads `AGENTS.md` (`@AGENTS.md`); `SessionStart` runs again after compaction.

### Codex CLI

```sh
todopi setup codex
```

Writes `SessionStart` and `SessionEnd` hooks to `.codex/hooks.json`. Review and trust new or changed hooks before Codex runs them. Codex reads `AGENTS.md` directly.

### OpenCode

```sh
todopi setup opencode
```

Writes `.opencode/plugins/todopi.js`, which injects `todopi prime` at session start and after compaction. OpenCode reads `AGENTS.md` directly.

### pi

```sh
todopi setup pi
```

Writes `.pi/extensions/todopi.ts`, which injects `todopi prime` at session start and after compaction. Review and trust the project before pi loads project-local extensions. pi reads `AGENTS.md` directly.

### Cursor

```sh
todopi setup cursor
```

Writes `sessionStart` and `sessionEnd` hooks to `.cursor/hooks.json` and an always-applied `.cursor/rules/todopi.mdc` rule file. The rule prompts the agent to run `todopi prime` after compaction. Cursor Agent CLI session start, rule loading, an actual `/summarize` followed by recovery of the ledger pointer, and the JSON session-end hook were tested in an isolated project. Cursor IDE chat and hooks remain unverified. After upgrading from an earlier version, run `todopi setup cursor` again to update a standard old project hook; review warnings about customized old hooks.

### Gemini CLI

```sh
todopi setup gemini
```

Writes hooks to `.gemini/settings.json` and adds `AGENTS.md` to `context.fileName`. After manual compression it injects `todopi prime` into the next turn; after automatic compression the protocol asks the agent to run `prime`.

The `--user` option installs shared hooks or extensions in your home directory. Even with `--user`, Claude Code's `CLAUDE.md` and Cursor's `rule file` stay in the repository. Only use it if you want to change your personal agent configuration.

## Working with the ledger

`todopi init` adds a protocol to `AGENTS.md` between `<!-- todopi:protocol:begin -->` and `<!-- todopi:protocol:end -->`. Agents should claim a task before work, note discoveries, check acceptance criteria and run `todopi done` after finishing. The ledger lives under `.todopi/tasks/` and can be reviewed in Git.

`--json` is available for commands that return data; its output contract is in [`json.md`](json.md). Piped output is plain text. For a task from Beads Classic, `todopi import beads` reads `.beads/issues.jsonl` and keeps the old ID in `external.beads.id`.

A task may set `verify` to a project command. Before the first run, inspect that command and confirm repository trust. In a non-interactive agent session, the user can approve it explicitly with `todopi done TASK_ID --yes`. A command allowlist for todopi does not sandbox `verify`; use an OS-level sandbox if the command needs isolation.

Binaries exist for macOS and Linux on x64 and arm64. The installer checks SHA-256 against the release's `SHA256SUMS` before installing a binary.
