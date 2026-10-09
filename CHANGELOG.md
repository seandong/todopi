# Changelog

## 0.2.1

- **Cursor session end**: return valid JSON from the read-only handoff hook. Re-run `todopi setup cursor` to upgrade a standard project hook in place; customized old hooks are preserved and reported so they can be reviewed separately. Cursor Agent CLI was verified; Cursor IDE chat remains unverified.
- **Installer recovery**: when launched from a deleted working directory, `install.sh` switches to a live directory before starting npm or the downloaded binary. Validated on macOS and in Linux installation checks.
- **CLI help**: color command and option names in an interactive terminal while keeping agent, JSON, and piped output plain.

## 0.2.0

- **Cargo-style terminal output** across CLI commands: aligned action labels, status colors, readable task listings, and emphasized error and warning messages. Agent, hook, JSON, and ordinary piped output stay plain; `NO_COLOR` is honored.
- **One-step agent setup**: `todopi init --setup claude` initializes a ledger and connects an agent. Repeat `--setup` or pass comma-separated agents to connect several; invalid names fail before writing. If setup stops partway through, the error lists what completed and how to resume.
- **Board test reliability**: polling tests wait for observed callbacks instead of fixed positive sleeps. The earlier intermittent full-suite failure could not be traced to a specific assertion because its detailed output was not retained.

## 0.1.0 — first release

todopi keeps a dependency-aware task graph for AI coding agents as plain Markdown files under `.todopi/`, in the format specified in [`spec/todopi-format-v1.md`](spec/todopi-format-v1.md) (format version 1).

- **Ledger commands**: `init`, `add`, `ls` / `ready`, `show`, `claim`, `release`, `note`, `check`, `edit`, `move`, `dep`, `done`, `close`, `reopen`, and `doctor` (with `--fix`). Writes are atomic and serialized by a file lock; claims are leases shared across git worktrees.
- **Verified completion**: `todopi done` runs the task's `verify` command (killing the whole process group on timeout) and refuses to close the task while it fails. `--force --reason` gets past it and is recorded in the task's Log for good.
- **Session continuity**: `prime` prints what you are working on at session start and after compaction; `handoff` reports what the session did without releasing claims.
- **Agent setup**: `todopi setup claude | codex | opencode | pi | cursor | gemini` installs each agent's hooks (and rule-file import), project-level by default or with `--user`. When `setup`'s hooks and a marketplace package are both installed, `prime` injects once per session start.
- **Importers**: `import <plan.md>` turns a Markdown checkbox plan into tasks; `import beads` migrates a Beads Classic export.
- **Board**: `todopi web`, a read-only board on 127.0.0.1 that updates as the files change.
- **Machine-readable output**: `--json` on every command that reports something (all but `web`), documented in [`docs/json.md`](docs/json.md).
- **Install**: npm package `todopi`, prebuilt binaries for macOS and Linux (x64, arm64) with SHA-256 checksums, and `install.sh`, which picks between them.
