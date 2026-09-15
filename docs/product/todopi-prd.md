# todopi — Product Requirements Document

Version: 1.1 · 2026-09-15
Companion documents: `spec/todopi-format-v1.md` (on-disk format), `docs/product/2026-09-14-todopi-agent-task-ledger-brainstorm.md` (research and decision log, Chinese)

---

## 1. Summary

todopi is a durable task ledger for AI coding agents. It is a single CLI (`todopi`, alias `tp`) that keeps a dependency-aware task graph as plain Markdown files inside the repository, so that any coding agent — Claude Code, Codex CLI, OpenCode, pi, Cursor, Gemini CLI — knows where the work stands across sessions, context compactions, machines, and agent switches, and cannot mark work done without evidence.

Launch line: *Your agent's tasks, in your repo, in 12 fields. Survives compaction, sessions, and switching agents.*

## 2. Problem

1. **Agents forget.** Every agent's built-in todo list is session-shaped, and in 2026 vendors are turning them off by default (Claude Code on new models, Codex `update_plan`, OpenCode V2, Gemini CLI). Context compaction drops the plan, so agents redo finished work, retry failed approaches, and lose constraints they had discovered.
2. **"Done" is self-reported.** Models grade their own work generously. Nothing in the loop runs the acceptance check before the checkbox is ticked.
3. **Existing trackers are either heavy or thin.** Beads proved the abstractions (ready queue, claim, prime, dependency graph) and then buried them under a database, a daemon and 100+ subcommands. The minimal clones dropped the machinery but also the format stability and the cross-agent integration. Spec-driven tools produce checkbox lists with no ids, no graph, no "where am I" view.

## 3. Goals and non-goals

### Goals (v0.1)

- G1. A task created in one session is found, with its history, by the next session — any agent, any machine, after any compaction.
- G2. A task cannot be closed as done while its verification command fails, its acceptance criteria are unchecked, or its children are open, except by an explicit, logged force.
- G3. Installing into any of six agents is one command; the agent receives task context automatically at session start and after compaction.
- G4. Everything is plain files in git, human-readable in a PR, and specified independently of the CLI.
- G5. Token cost is bounded: the context injection is capped, listings are terse, closed work is folded.

### Non-goals

- Running or orchestrating agents; managing worktrees.
- Human project management (cycles, estimates, due dates, reports).
- Any server, daemon, database, network call, LLM call, telemetry, or automatic git operation.
- Multi-agent "factory" scale (tens of concurrent agents) and team permissions.
- Cloud sync, hosted board, MCP server, Linear/GitHub sync — deferred to v0.2+.

## 4. Users

| Persona | Situation | What they need from todopi |
|---|---|---|
| **Solo developer with 1–3 agents** (primary) | Works on one project across days, switching between Claude Code and Codex; runs long tasks that compact | Resume without re-explaining; trust "done"; see progress at a glance |
| **Autonomous-loop user** (secondary) | Runs Ralph-style loops or 2–3 parallel worktrees | An atomically claimable ready queue; verification as back-pressure |
| **Human reviewer** | Reviews the agent's PR | Task files in the diff: who claimed, what was verified, which criterion failed |

## 5. Principles

1. Files are the database. `.todopi/` is committed; no index is committed.
2. No resident process, database, API key, LLM call, telemetry, or automatic git. `todopi web` is a foreground process bound to loopback that ends with the terminal that started it; nothing listens while you are not looking.
3. The CLI is the only writer. It validates fields, holds a lock, writes atomically. Humans may edit files; `doctor` catches damage.
4. Be lenient with agents: accept the verbs they guess, never lose data on bad input, `--json` everywhere, stable exit codes.
5. Be stingy with tokens: hard cap on `prime`, short default output, closed tasks folded.
6. Done needs evidence.
7. Format before features: the on-disk format is versioned and public; the CLI is one implementation.
8. Complement, don't replace: agents keep their in-turn micro-plans; todopi holds what must outlive the context window.
9. Never collect usage data.

## 6. Product surface

| Surface | Description |
|---|---|
| CLI | `todopi` / `tp`; TypeScript, Bun-compiled single binary via brew/curl; npm package runs on Node ≥ 20 |
| Data | `.todopi/` at repo root; format per `spec/todopi-format-v1.md` |
| Board | `todopi web`: local, 127.0.0.1-only, single-page, no accounts; read-only in v0.1 |
| Integrations | `todopi setup <agent>` for claude, codex, opencode, pi, cursor, gemini; each also published to its agent's marketplace/registry |
| Importers | `todopi import <plan.md>` and `todopi import beads` |
| Site | todopi.com: install, docs, format spec; English first, Chinese pages secondary |

## 7. Functional requirements

Each requirement has an id, a statement, and acceptance. "Task" means a file conforming to the format spec.

### 7.1 Tasks

- **FR-T1** `add` creates a task with title, optional description, parent, blockers, labels, acceptance criteria, verify command, and `--from <id>` provenance. It assigns a `rank` ordering the task last, so that every task todopi writes carries one. *Accept:* file exists, passes `doctor`, Log has `created`.
- **FR-T2** `ls` lists tasks; filters `--open` (default), `--closed`, `--ready`, `--blocked`, `--mine`, `--label`; `--json` emits an array; `--limit N`. Closed tasks are hidden unless asked. Stale and unverified tasks are marked.
- **FR-T3** `show <id>` prints frontmatter, criteria with indices, last 5 Log lines with total count; `--full`, `--tree` (parent chain and children with progress), `--json`.
- **FR-T4** `edit <id>` changes title, description, verify, labels, parent, and body sections via flags or `--edit` ($EDITOR). Logs `edited fields=…`.
- **FR-T5** `move <id> --top | --before <id> | --after <id>` is the only way to change `rank`; it rewrites exactly one file. This holds because every task carries a rank from creation (FR-T1): a mixed population of ranked and unranked tasks would make `--after` unsatisfiable, since any task that acquires a rank sorts ahead of every unranked one.
- **FR-T6** Ids: `<prefix>-<6 base36>`, random, collision-checked locally.
- **FR-T7** There is no priority field, no type field, no delete command. Soft delete is `close --as obsolete`.

### 7.2 Graph

- **FR-G1** `dep add <id> --on <id>` / `dep rm` maintain `blocked_by`; cycles are refused (exit 1) with the cycle printed.
- **FR-G2** `ls --ready` (alias `ready`) implements the spec's ready definition and ordering; output is what an agent should pick from.
- **FR-G3** Containers (tasks with children) never appear in ready and show `n/m` child progress.

### 7.3 Claim and lease

- **FR-C1** `claim <id> [--as <actor>]` sets `status: in_progress` and `assignee`, creates the lease atomically, logs `claimed`. A task the ready queue offers can always be claimed: a stale `in_progress` task is reclaimed without ceremony, because a queue that offers work and a claim that then refuses it would contradict each other. Only a *live* lease refuses (exit 3), and `--steal` overrides it. Either way, replacing another actor's `assignee` logs `steal=true` naming who was replaced.
- **FR-C2** `release <id>` clears assignee, deletes the lease, logs `released`.
- **FR-C3** Every write by the holder refreshes the lease heartbeat and `updated`.
- **FR-C4** Actor resolution: `--as` > `TODOPI_ACTOR` > agent environment inference (`claude-code@<host>`, `codex@<host>`, …) > `git config user.name`. An actor identifies a worker, not a session, so it is stable across sessions of the same tool on the same machine — otherwise resuming yesterday's own task would require stealing it. Values from `git config` are normalized per the format spec §5.4 (they commonly contain spaces, which the actor grammar forbids). `--as` overrides identity for queries as well as writes, which is how a person inspects another actor's work without configuration.
- **FR-C6** Identity is matched two ways, and which one applies is decided by whether the command writes. **Writes match strictly:** `note`, `check`, `edit`, `done`, `close`, the heartbeat refresh, and the notes `handoff` appends are refused (exit 3) when the task's `assignee` is another actor, so two workers cannot interleave writes on one task. **Displays match broadly:** `ls --mine`, `prime`, and the report `handoff` prints treat as "mine" any task whose assignee is the resolved actor *or* ends in `@<this host>`. A person at a terminal is therefore shown what their agents are doing, which is the whole point of those three commands; no configuration and no stored list of actors is required.
- **FR-C5** Leases live in `.git/todopi/leases/` (shared across worktrees), fall back to `.todopi/.cache/leases/` without git. The same directory holds the rest of the machine-local runtime state, including each session's last `prime` time (FR-P1). Session identity lives here and never enters a task file.

### 7.4 Definition of done

- **FR-D1** `check <id> <n>` / `check <id> <n> --undo` toggles criterion n; logs it.
- **FR-D2** `done <id>`: if `verify` is set, print the command about to run, then run it from the repo root with the configured timeout and capture output; refuse (exit 2) on non-zero. Refuse if any criterion is unchecked, if any child is not `closed`, or if the task is assigned to another actor (FR-C6). On success set `closed`/`done`, log `done verify=… commit=<HEAD7> dirty=<bool>`, delete lease.
- **FR-D2a** A refusal prints a report that is actionable without further commands, because it is the only thing the agent sees and the protocol tells it to fix the work rather than force it. The report names the gate that refused and its specifics: unchecked criteria listed individually with their indices and text; children that are not closed listed with id, title and status; for `verify`, the command as run, its exit code and the tail of its output; for an assignee conflict, the holding actor and when it last wrote. It ends with the two ways forward — fix and re-run `done`, or `--force --reason <text>`. Nothing is appended to the Log: no state changed (format spec §5.3.3). An agent that wants to record what it learned uses `note`.
- **FR-D3** `--force --reason <text>` bypasses any gate and logs `forced=true` with the reason; such tasks are marked "unverified" in listings and the board.
- **FR-D4** First `verify` execution in a repository asks for confirmation and records trust by repository path in `~/.config/todopi/trust`; `--yes` or `CI=true` skips the prompt. Trust is never stored inside `.todopi/`: a record that travels with the repository would let the repository certify itself. Because `verify` is an ordinary task field that any writer can change — an agent, a hand edit, a merged pull request — trust by path does not bound *what* runs after it is granted. Two things narrow that: the command is printed verbatim before every execution, so it is never silently different from last time; and `handoff` lists tasks whose `verify` changed since the actor's last `prime` (FR-H1). Trust by command content is planned for v0.2, when the cost of re-prompting is justified by users who accept outside contributions.
- **FR-D4a** Verify output placement follows from the Log being committed and `prime` being budgeted. A passing verify records no output: the command is in the frontmatter and the commit is in the Log, which is everything a reviewer needs to reproduce it. A forced close records the last 512 bytes, because bypassed verification is the one case a human must review and the evidence has to be visible in the diff. Full output is always written to `.todopi/.cache/verify/`, which is not committed and may be deleted at any time.
- **FR-D5** `close <id> --as wontfix|duplicate|obsolete [--reason]` and `reopen <id>` per the state machine. `reopen` clears `assignee` along with `resolution`, or it would leave a task that violates the format's own invariant. The soft-delete resolution is `obsolete` rather than `stale` because `stale` already names a derived state — an `in_progress` task whose lease expired — and the two would otherwise appear side by side in the same listing meaning unrelated things.

### 7.5 Log

- **FR-L1** `note <id> <text>` appends a Log line; multi-line text is supported.
- **FR-L2** All state changes append a Log line in the spec grammar; nothing rewrites earlier lines.

### 7.6 Context injection

- **FR-P1** `prime [--budget <tokens>]` (default 1500) prints Markdown in this order: (1) the 6-line protocol reminder; (2) the caller's in-progress task(s): title, criteria with state, last 3 Log lines; (3) tasks held by other actors on this machine: id, title, holder — so the caller does not redo work another agent is doing, clearly labelled as not its own; (4) top 5 ready tasks: id and title; (5) counts: open / in progress / blocked / closed; (6) last 3 closed titles. Tokens are estimated as characters ÷ 4.
- **FR-P1a** Budget rules. The protocol reminder is pinned: it is a ~100-token constant and it is what tells an agent how to use todopi at all after a compaction, so it is never the thing that gets dropped. Every other item has a sub-budget and is truncated internally before the next item is dropped — within a task, unchecked criteria survive checked ones and the newest Log line survives the older ones — so that a caller holding five long tasks still receives a ready queue. Items are dropped from the end.
- **FR-P1b** `prime` records its call time per session, in the runtime directory of FR-C5, for FR-H1. Where an agent exposes no session identifier the record falls back to being keyed by actor; two concurrent sessions of that agent then share one timestamp, which is a known limitation of the fallback and not of the design.
- **FR-P2** `prime --json` emits the same content as structured data.

### 7.7 Handoff

- **FR-H1** `handoff` prints, using the broad identity match of FR-C6 so that a person sees what their agents did: in-progress tasks with no Log entry in the last hour; tasks created since the last `prime`; tasks whose `verify` command changed since then (FR-D4). It then appends a `handoff` Log line with a summary to each in-progress task **it is the assignee of** — the write path is strict — and refreshes those heartbeats. It does not release. `--check` exits 0 with the report only (for hooks).

### 7.8 Agent integration

- **FR-A1** `setup <agent>` installs, idempotently, the agent's skill/rules file and hooks. Default target is project-level configuration (so a clone works); `--user` targets user-level. It prints every file it wrote.
- **FR-A2** Hook mapping: Claude Code `SessionStart` (startup, resume, compact) → `prime`; `SessionEnd` → `handoff --check`. Codex `SessionStart`, `PostCompact` → `prime`; `SessionEnd` → `handoff --check`. OpenCode plugin: `session.compacted` → `prime`. pi extension: `session_start`, `session_before_compact` → `prime`. Cursor and Gemini: rules file plus commands.
- **FR-A3** All agents receive the same ≤ 800-token instruction text (the "protocol", §9); per-agent packaging only wraps it.
- **FR-A4** Each integration is published to its agent's marketplace/registry at launch: Claude Code plugin, Codex plugin, OpenCode plugin, pi package (npm), Cursor rules, Gemini extension.

### 7.9 Local board

- **FR-B1** `web [--port 4747] [--open]` serves a single-page board on 127.0.0.1 only. The process runs in the foreground and exits with its terminal.
- **FR-B2** Views: columns by display state (open, blocked, in progress, done, closed), tree by container, ready queue; a task drawer shows criteria, Log, verification evidence.
- **FR-B3** The v0.1 board is **read-only**. Its stated purpose is to let a person see at a glance what the agent is doing, and reading satisfies that purpose entirely. The four write operations — drag between columns, toggle criteria, add note, drag to reorder — move to v0.2. They are the expensive half: each must go through the same validated, locked write path as the CLI, which would force the CLI's write path to be factored into a reusable interface in the first week of implementation, and each needs a force dialog with a required reason. Deferring them removes an architectural commitment from v0.1 without touching anything the launch depends on: the board carries no distribution value, and the launch demo is a terminal recording.
- **FR-B4** The page refreshes on file change (SSE from a directory watcher).

### 7.10 Importers

- **FR-I1** `import <file.md>`: parses Markdown checkbox lists (Superpowers plans, spec-kit `tasks.md`, OpenSpec `tasks.md`). Headings become containers, items become children, document order becomes `rank`, checked items are created `closed/done` with `forced=true` (no verification ran). Each task records `created source=<path>`; re-import is idempotent on (source, title).
- **FR-I2** `import beads [path]`: reads Beads Classic `issues.jsonl` (default `.beads/issues.jsonl`). Mapping: priority → rank order; type → label; `blocks` → `blocked_by`; parent-child → `parent`; closed → `closed` with `done` (or `wontfix` when Beads reason says so); original id under `external.beads.id`. Dolt-era exports are out of scope.

### 7.11 Quality and operations

- **FR-Q1** `doctor [--fix]` checks every invariant in the spec, conflict markers, unknown keys, orphan leases; `--fix` normalizes key order, timestamps and checkbox syntax, backfills a missing `rank` in `created` order (FR-T5), and removes expired leases. It **never modifies the Log**, not even a line that fails to parse — it reports those instead. An append-only history that a repair tool may rewrite is not evidence, and the Log is what this product offers as evidence. Exit 1 if problems remain.
- **FR-Q2** Exit codes: 0 ok · 1 usage/validation error · 2 gate failed (verify/criteria/children) · 3 conflict (lease held, concurrent write) · 4 format version unsupported.
- **FR-Q3** `--json` output shapes are documented and versioned with the CLI; breaking changes bump the CLI major version.
- **FR-Q4** Verb leniency: `done|finish|complete`, `close|cancel`, `ls|list`, `add|new|create`, `note|log`, `dep|block` are accepted as aliases; aliases are not counted as subcommands.
- **FR-Q5** `init` creates `.todopi/` with `config.yml`, `tasks/`, `.gitignore`, and appends the protocol text to `AGENTS.md` (creating it if absent). It never touches `CLAUDE.md` unless `setup claude` is run.

## 8. Command reference (20 subcommands)

```
todopi init [--prefix tp]
todopi setup <claude|codex|opencode|pi|cursor|gemini> [--user]
todopi add <title> [-d text] [--parent id] [--blocked-by id,…] [--label l]… [--ac text]… [--verify cmd] [--from id] [--edit]
todopi ls [--open|--closed|--all] [--ready] [--blocked] [--mine] [--label l] [--limit n] [--json]
todopi show <id> [--full] [--tree] [--json]
todopi edit <id> [--title t] [-d text] [--verify cmd] [--label +l|-l] [--parent id|none] [--edit]
todopi done <id> [--evidence text] [--force --reason text] [--yes]
todopi close <id> --as <wontfix|duplicate|obsolete> [--reason text] [--force]
todopi reopen <id>
todopi move <id> --top|--before <id>|--after <id>
todopi dep add <id> --on <id> | dep rm <id> --on <id>
todopi claim <id> [--as actor] [--steal]
todopi release <id>
todopi note <id> <text>
todopi check <id> <n> [--undo]
todopi prime [--budget n] [--json]
todopi handoff [--check]
todopi web [--port n] [--open]
todopi doctor [--fix]
todopi import <file.md> | import beads [path]
```

Global flags: `--json`, `--quiet`, `--as <actor>`, `-C <dir>`.

## 9. Agent protocol (content of SKILL.md / AGENTS.md snippet, ≤ 800 tokens)

The text every agent gets, in outline:

1. **What todopi is**: the repository's durable task ledger; `.todopi/` is data, never edit it by hand, use the CLI.
2. **Granularity**: one todopi task ≈ one change worth a commit, with a checkable outcome. Editing one file or running one test is not a task.
3. **Moments** (do these, don't deliberate): session start → read the `prime` output you were given (or run `todopi prime`); before working → `todopi claim <id>`; discovered new work → `todopi add "<title>" --from <current id>`; learned something the hard way → `todopi note <id> "<what and why>"`; finished → `todopi done <id>` (it runs the verification; fix the work, don't force); ending the session → `todopi handoff`.
4. **Native todo lists**: keep using yours for the steps inside this turn; never copy todopi tasks into it.
5. **Commits**: include `.todopi/` changes in the commit for the work; mention the task id in the message.
6. **Queries**: `todopi ls --ready` for what to do next; `todopi show <id>` for details; add `--json` when parsing.

This text is a product artifact: its wording is tuned by dogfooding, and changing it is not a code change.

## 10. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | Any command on a repository with 2,000 tasks completes in < 200 ms on a laptop (cold cache < 1 s). `prime` never exceeds its budget. |
| Platforms | macOS and Linux supported; Windows best-effort (CI runs, failures do not block release). |
| Runtime | npm package runs on Node ≥ 20 without Bun; brew/curl deliver a Bun-compiled binary with no runtime dependency. |
| Security | Verify commands run only after per-repository trust and are printed before every execution; board binds to loopback; no network access anywhere in v0.1. Documentation states plainly that allowing `todopi` in an agent's command allowlist is not a sandbox: `done` executes the repository's own `verify` command, which the agent's permission check does not see. |
| Privacy | No telemetry, ever. Documentation warns that `.todopi/` is public in public repositories. |
| Compatibility | Format version 1; CLI refuses to write newer versions (exit 4). |
| Localization | CLI and docs in English; Chinese site pages secondary. |
| Licensing | MIT. |

## 11. Release plan

| Version | Scope |
|---|---|
| **v0.1 (MVP)** | Everything in §7; six integrations on marketplaces; both importers; board; site with format spec; Show HN launch |
| **v0.2** | Board writes (FR-B3), trust by command content (FR-D4), an optional `project_id` config key, native-todo mirroring (Claude Code `TaskCreated/TaskCompleted` hooks, OpenCode plugin), commit/PR linking, git merge driver for task files, Linear one-way push (todopi is source of truth), `remember` memory entries in `prime`, thin MCP adapter (≤ 5 tools), GitHub Issues after Linear |
| **v0.3+** | Cross-repo view, hosted sync and shared board (paid), bidirectional sync, task-level cost attribution |

## 12. MVP acceptance

1. This repository manages its own development with todopi across ≥ 3 sessions using both Claude Code and Codex, with no lost progress and no duplicated work attributable to the ledger.
2. On this repository's real ledger, what `prime` prints within its budget is enough for a fresh session to resume correctly without opening any other file — confirmed by hand across 3 sessions. Measuring that the output fits the budget would prove nothing, since it is truncated to fit by construction; what needs proving is that the truncation order drops the least useful content first.
3. A new user goes from nothing installed to a claimable task in ≤ 2 minutes following the README.
4. `doctor` passes on the repository's ledger at every release tag.
5. Each of the six `setup` targets installs cleanly on a fresh clone and the agent receives `prime` output at session start (verified manually per agent before launch).

## 13. Launch checklist (Show HN, no soft launch)

- [ ] Format spec published at todopi.com/spec with the twelve-field table
- [ ] 30-second recording: compaction happens, the agent continues from `prime`
- [ ] README: install for six agents, the protocol, "vs Beads" paragraph, pronunciation and name origin
- [ ] npm `todopi`, brew tap, curl installer live; `@todopi` scope claimed
- [ ] Six marketplace/registry listings live
- [ ] `import beads` tested against at least two real Beads Classic exports
- [ ] awesome-list PRs prepared for the week after launch
- [ ] Domain: todopi.com renewed, todopi.dev registered

## 14. Risks

| Risk | Mitigation |
|---|---|
| Crowded category (Beads and a dozen minimal clones) | Compete on the public format, one-command cross-agent setup, verified completion, capped prime; not on feature count |
| A vendor ships durable, in-repo tasks natively | Stay cross-agent and diffable; be the format others read |
| Agents ignore or misuse the ledger | Hooks rather than prompts; lenient verbs; handoff review of agent-created tasks; tune the protocol text from dogfooding |
| Scope creep (Beads' failure mode) | Hard cap of 20 subcommands in v0.1; each addition must remove something |
| Six integrations for one maintainer | Integrations are thin wrappers around one protocol text plus `prime`/`handoff`; contract tests run all six in CI |
| Same task edited on two branches conflicts | Accepted for v0.1 (rare for solo use); `doctor` detects markers; merge driver in v0.2 |

## 15. Open items

Implementation defaults (decided unless objected to): random 6-char base36 ids; UTC second timestamps; `.todopi/` only at repo root; leases fall back to `.cache/` without git; `prime` truncation order as in FR-P1/P1a; characters ÷ 4 token estimate; "this session" = since this session's last `prime`, falling back to this actor's where the agent exposes no session id; closed blockers unblock regardless of resolution; no hard delete.

Deferred with a named trigger, so that "later" does not become "never":

- **Cross-repository view** (`ls --all`) stays in v0.3. It needs a user-level registry of repositories and repository-qualified output, and it serves the maintainer rather than the launch: none of the five MVP acceptance criteria touch more than one repository. Reconsider during dogfooding if the daily loop turns out to span repositories — the minimal form is one flag and an auto-populated registry, roughly half a day, and it costs none of the 20-subcommand budget. Until then the README documents the shell loop over `-C`.
- **`project_id`** — a stable identifier surviving moves and clones, needed by the cross-repository view and by any later sync. Not added now because the format spec §9 classes a new config key as an additive change that does not bump the format version, so it can be introduced whenever it has a consumer and backfilled by `doctor --fix`. Adding it before then would ship a field nothing reads.

Actions for the product owner: renew todopi.com (expires 2026-11-20); register todopi.dev; publish `todopi` / `@todopi` placeholders on npm; create the GitHub org; manual trademark search (USPTO, EUIPO); obtain two real Beads Classic exports for importer tests.

## 16. Decision log

Thirty product decisions were taken on 2026-09-14 and are recorded, with rationale and research, in `docs/product/2026-09-14-todopi-agent-task-ledger-brainstorm.md` §10.

A review on 2026-09-15 resolved eleven issues found in that draft and in the format spec, and produced version 1.1 of this document. The substantive changes: ranks are assigned at creation (FR-T1/T5); the state machine gained reclaim and `reopen` clears `assignee`; criterion checks carry their text into the Log; verify output no longer enters the Log on success; refused transitions are not logged at all and instead produce a structured report (FR-D2a); identity is matched strictly for writes and broadly for displays (FR-C6); `prime` pins the protocol reminder and sub-budgets every item (FR-P1a); the v0.1 board is read-only (FR-B3); the soft-delete resolution is renamed `obsolete`; and MVP acceptance no longer asserts a tautology.
