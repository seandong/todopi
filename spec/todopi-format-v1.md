# The `.todopi/` Format, Version 1

Status: Draft for review · 2026-09-14
Applies to: `version: 1` in `.todopi/config.yml`

This document specifies the on-disk format that todopi reads and writes. It is written so that a third-party tool can read and write a `.todopi/` directory without the todopi CLI. The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as described in RFC 2119.

The format is deliberately small: one directory, one config file, one Markdown file per task, twelve frontmatter fields. Everything else is derived.

---

## 1. Location and discovery

1. A `.todopi/` directory lives at the root of a git repository (the directory containing `.git`). One repository has at most one `.todopi/` directory. Nested `.todopi/` directories are not supported in v1; a reader that finds one below the root MUST ignore it and SHOULD warn.
2. A tool discovers `.todopi/` by walking up from the current working directory until it finds a directory containing `.todopi/`, or reaches the filesystem root.
3. A `.todopi/` directory MAY exist outside a git repository. Everything in this specification works without git except the lease directory location (see §8).

## 2. Directory layout

```
.todopi/
├── config.yml          # required
├── tasks/              # required; one file per task
│   └── <id>.md
├── .cache/             # optional; MUST be gitignored; MAY be deleted at any time
└── <other>/            # reserved for future versions; readers MUST ignore
```

- `tasks/` MUST contain only files named `<id>.md` where `<id>` is a valid task identifier (§4). Readers MUST ignore other entries and SHOULD warn.
- `.cache/` holds derived data (indexes, leases when there is no `.git/`). Its contents are not part of the format; nothing in it may be needed to reconstruct state.
- `todopi init` writes a `.gitignore` inside `.todopi/` containing `.cache/`.

## 3. `config.yml`

A YAML mapping. All keys are optional except `version`.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `version` | integer | required | Format version. This document describes `1`. |
| `id_prefix` | string | `tp` | Prefix for new task identifiers. MUST match `^[a-z][a-z0-9]{0,7}$`. Changing it does not rename existing tasks. |
| `lease_hours` | number | `2` | Hours without a heartbeat after which an `in_progress` task is considered stale (§7.3). |
| `verify_timeout_seconds` | integer | `600` | Timeout for `verify` commands. |

Unknown keys MUST be preserved by writers and ignored by readers.

Example:

```yaml
version: 1
id_prefix: tp
lease_hours: 2
verify_timeout_seconds: 600
```

## 4. Task identifiers

- Grammar: `<prefix>-<body>` where `<prefix>` is the configured `id_prefix` at creation time and `<body>` is exactly six characters from `[0-9a-z]`. Regex: `^[a-z][a-z0-9]{0,7}-[0-9a-z]{6}$`.
- Identifiers are immutable. The file name is `<id>.md`.
- Generation: the body is drawn uniformly at random. Before use, the writer MUST check that no file with that name exists in `tasks/` and regenerate on collision. The space (36^6 ≈ 2.2 billion) makes cross-branch collisions negligible; a merge that produces two files with the same id is a conflict for `doctor` to report.
- Rationale for random rather than sequential: several agents on several branches create tasks concurrently; sequential numbering would collide on merge.

## 5. Task file

### 5.1 Envelope

- Encoding UTF-8, line endings LF, no BOM.
- The file MUST begin with a line `---`, followed by a YAML mapping, followed by a line `---`, followed by the Markdown body. The body MAY be empty.
- Writers MUST emit frontmatter keys in the order listed in §5.2 so that diffs are stable. Readers MUST accept any order.

### 5.2 Frontmatter fields

Twelve fields are defined. Four are always required.

| # | Field | Type | Required | Constraints |
|---|---|---|---|---|
| 1 | `id` | string | yes | §4; MUST equal the file name minus `.md` |
| 2 | `title` | string | yes | single line, 1–200 characters after trimming |
| 3 | `status` | enum | yes | `open` · `in_progress` · `closed` |
| 4 | `resolution` | enum | iff `status: closed` | `done` · `wontfix` · `duplicate` · `stale`; MUST be absent when status is not `closed` |
| 5 | `assignee` | string | iff `status: in_progress` | actor string, `^[^\s:]{1,64}$`; MAY be present when `closed` (who closed it); MUST be absent when `open` |
| 6 | `parent` | id | no | MUST reference an existing task; MUST NOT equal `id`; the parent chain MUST be acyclic |
| 7 | `blocked_by` | list of id | no | each MUST reference an existing task; MUST NOT contain `id`; the blocked-by graph MUST be acyclic; empty list is equivalent to absent |
| 8 | `rank` | string | no | `^[0-9a-z]{1,32}$`; see §7.4 |
| 9 | `verify` | string | no | a shell command line, run from the repository root |
| 10 | `labels` | list of string | no | each `^[a-z0-9][a-z0-9_.-]{0,31}$`; no duplicates |
| 11 | `external` | mapping | no | keys are system names (`linear`, `github`, `beads`, …); values are mappings; writers MUST preserve entries they do not understand |
| 12 | `created` / `updated` | timestamp | yes | RFC 3339, UTC, second precision, `Z` suffix, e.g. `2026-09-14T09:00:00Z`; `updated` ≥ `created` |

(`created` and `updated` are counted as one field family; there are thirteen keys.)

Additional keys:

- Keys beginning with `x-` are extension keys. Readers MUST ignore them and writers MUST preserve them verbatim.
- Any other unknown key MUST be preserved by writers; readers SHOULD warn (this is how a v1 reader behaves on a file written by a later minor revision).

Fields intentionally absent, and why:

- `priority` — an agent-writable scalar inflates; ordering is expressed by dependencies, `rank`, and `created`.
- `type` — a task with children is a container; `bug` etc. are `labels`.
- `blocks`, `children` — the inverse of `blocked_by` and `parent`; derived.
- `claimed_at`, lease heartbeat — runtime state, not committed (§8).
- `forced`, `verified` — recorded in the Log (§5.3.3) from which display state is derived.

### 5.3 Body

The body is Markdown. Four H2 headings are recognized, exactly and case-sensitively. Writers SHOULD emit them in this order. Any other content (other headings, paragraphs before the first heading) MUST be preserved by writers and ignored by readers.

```
## Description
## Acceptance Criteria
## Plan
## Log
```

#### 5.3.1 Description and Plan

Free Markdown. No structure is imposed.

#### 5.3.2 Acceptance Criteria

A flat list of GitHub-style task items:

```
- [ ] Existing passkey users can sign in
- [x] Three failures fall back to password
```

- Items are numbered 1..n in document order. Nested list items and non-checkbox lines are not criteria and MUST be preserved untouched.
- `[x]` and `[X]` both mean checked; writers emit `[x]`.
- The section is "satisfied" when it has zero unchecked items (an empty or absent section is satisfied).

#### 5.3.3 Log

An append-only list of events, one item per line, newest last. Writers MUST append at the end and MUST NOT modify or reorder earlier lines.

Grammar (one item):

```
- <timestamp> <actor> <verb>[ <key>=<value>]*[: <text>]
```

- `<timestamp>`: RFC 3339 UTC seconds, `Z` suffix.
- `<actor>`: `[^\s:]{1,64}`.
- `<verb>`: one of the verbs below. Unknown verbs MUST be preserved and ignored.
- `<key>=<value>`: `key` is `[a-z_]+`; `value` is `[^\s]+` (no spaces). Order is not significant.
- `<text>`: free text to end of line. A multi-line text continues on following lines indented by two spaces; readers join them with `\n`.

Verbs and their arguments:

| Verb | Arguments | Emitted by |
|---|---|---|
| `created` | `from=<id>` (optional; the task being worked on when this one was discovered) · `source=<path>` (optional) | `add`, `import` |
| `claimed` | `steal=true` (optional) | `claim` |
| `released` | — | `release` |
| `note` | — (text required) | `note`, `handoff` |
| `check` / `uncheck` | `ac=<n>` | `check` |
| `done` | `verify=pass\|fail\|none` · `commit=<sha7>` · `dirty=true\|false` · `forced=true` (only when forced; text = reason) | `done` |
| `closed` | `resolution=wontfix\|duplicate\|stale` · `forced=true` (when children were open) | `close` |
| `reopened` | — | `reopen` |
| `moved` | — | `move` |
| `edited` | `fields=<comma-list>` | `edit` |
| `imported` | `source=<path>` · `system=<name>` | `import` |
| `handoff` | — (text = summary) | `handoff` |

Examples:

```
- 2026-09-14T09:00:00Z sean created from=tp-9f00k2
- 2026-09-14T10:12:00Z claude-code@mbp claimed
- 2026-09-14T10:20:00Z claude-code@mbp note: webauthn-lib 1.x breaks on Node 22, switched to 2.x
- 2026-09-14T10:41:00Z claude-code@mbp check ac=1
- 2026-09-14T11:02:00Z claude-code@mbp done verify=pass commit=3f2a1c9 dirty=true
```

A closed task whose most recent `done` or `closed` event carries `forced=true` is displayed as "unverified".

## 6. State

### 6.1 Stored states and transitions

| From | To | Command | Effects |
|---|---|---|---|
| `open` | `in_progress` | `claim` | set `assignee`; create lease; log `claimed` |
| `in_progress` | `open` | `release` | clear `assignee`; delete lease; log `released` |
| `open`, `in_progress` | `closed` (`done`) | `done` | run `verify` if present; require Acceptance Criteria satisfied; require no open children; set `resolution: done`; delete lease; log `done` |
| `open`, `in_progress` | `closed` (other) | `close --as` | require no open children; set `resolution`; delete lease; log `closed` |
| `closed` | `open` | `reopen` | remove `resolution`; log `reopened` |

Any transition that is refused by a gate (verify failed, criteria unsatisfied, open children, already claimed by a live lease) MAY be forced with `--force --reason <text>`. A forced transition MUST record `forced=true` and the reason in the Log.

`blocked` and `stale` are not stored states (§7).

### 6.2 Invariants

A conforming task set satisfies all of the following. `doctor` reports violations.

1. Every file in `tasks/` parses and its `id` matches its file name.
2. `resolution` is present iff `status` is `closed`.
3. `assignee` is present iff `status` is `in_progress`, or optionally when `closed`.
4. `parent` and every `blocked_by` entry reference existing files.
5. The `parent` graph and the `blocked_by` graph are each acyclic.
6. `updated` ≥ `created`.
7. No file contains git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) at line start.

### 6.3 `updated`

Every write to a task file MUST set `updated` to the current time. `updated` doubles as the cross-machine heartbeat for stale detection (§7.3), so writers that only touch the body (a note, a checkbox) still bump it.

## 7. Derived state

Readers compute the following; nothing here is stored.

### 7.1 Children and blocks

- `children(t)` = tasks whose `parent` is `t`.
- `blocks(t)` = tasks whose `blocked_by` contains `t`.
- A task with one or more children is a container. Containers never enter the ready queue and cannot be closed while any child is not `closed` (except by force).

### 7.2 Blocked

`blocked(t)` is true iff `t.status ≠ closed` and some task in `t.blocked_by` has `status ≠ closed`. A blocker closed with any resolution unblocks; `doctor` SHOULD warn when a blocker was closed as `duplicate` so the dependency can be re-pointed.

### 7.3 Stale

For a task with `status: in_progress`:

- If a lease file for `t` exists on this machine (§8): stale iff `now − lease.heartbeat_at > lease_hours`.
- Otherwise (another machine, a fresh clone): stale iff `now − t.updated > lease_hours`.

### 7.4 Ordering

Tasks are ordered by:

1. tasks with `rank`, ascending by codepoint comparison of `rank`;
2. then tasks without `rank`, ascending by `created`;
3. ties by `id`.

`rank` values are opaque strings chosen so that a new value can always be inserted between two existing ones by appending characters (the LexoRank idea). A writer that moves a task computes a new `rank` for that task only and MUST NOT rewrite other tasks' ranks; if no string fits between two neighbours it MAY renumber, and MUST then log `moved` on every task it touched.

### 7.5 Ready

`ready(t)` is true iff all of:

1. `children(t)` is empty;
2. `blocked(t)` is false;
3. `t.status = open`, or `t.status = in_progress` and `stale(t)`.

The ready queue is `ready` tasks in §7.4 order. Stale entries MUST be marked as such in any listing.

## 8. Leases and locking (runtime, not committed)

Leases are the short-term mutual exclusion between agents on one machine, including across git worktrees of the same repository.

- Directory: `<git-common-dir>/todopi/leases/` (i.e. `.git/todopi/leases/`, shared by all worktrees). Without git: `.todopi/.cache/leases/`.
- File: `<id>.json` — `{"actor": "...", "claimed_at": "<ts>", "heartbeat_at": "<ts>"}`.
- `claim` creates the file atomically (`O_EXCL`); if it exists and is not stale, the claim is refused unless `--steal`.
- Every write to the task by the lease holder updates `heartbeat_at`. `release`, `done`, `close` delete the file.
- Leases are advisory and machine-local. The committed `status`/`assignee`/`updated` triple is the durable record.

Write locking: a writer MUST hold an exclusive lock on `<lease-dir>/lock` (or `.todopi/.cache/lock` without git) for the duration of read-validate-write of any task file, and MUST write via a temporary file in `tasks/` followed by an atomic rename. Readers need no lock.

## 9. Versioning

- `version` is an integer. This document is version 1.
- Additive changes (new optional frontmatter keys, new Log verbs, new recognized sections, new config keys) do not change the version; v1 readers already tolerate them.
- Any change that alters the meaning of an existing key, adds a required key, or changes derived-state rules increments the version.
- A reader MUST refuse to write a `.todopi/` whose `version` is greater than the highest it implements, and SHOULD still read it.

## 10. Complete example

`.todopi/tasks/tp-a1b2c3.md`:

```markdown
---
id: tp-a1b2c3
title: Support passkeys on /login
status: in_progress
assignee: claude-code@mbp
parent: tp-9f00k2
blocked_by: [tp-7c21xx]
rank: a0m
verify: "pnpm test -- login"
labels: [auth]
created: 2026-09-14T09:00:00Z
updated: 2026-09-14T10:41:00Z
---

## Description

Users who registered a passkey should be able to sign in with it. Password
remains the fallback.

## Acceptance Criteria

- [x] Existing passkey users can sign in
- [ ] Three failures fall back to password

## Plan

1. Add /login/passkey/options and /login/passkey/verify
2. Client: conditional UI

## Log

- 2026-09-14T09:00:00Z sean created from=tp-9f00k2
- 2026-09-14T10:12:00Z claude-code@mbp claimed
- 2026-09-14T10:20:00Z claude-code@mbp note: webauthn-lib 1.x breaks on Node 22, switched to 2.x
- 2026-09-14T10:41:00Z claude-code@mbp check ac=1
```

## 11. Conformance checklist for third-party writers

- [ ] Preserve unknown frontmatter keys, `x-*` keys, unknown Log verbs, unrecognized body sections.
- [ ] Emit frontmatter keys in §5.2 order; timestamps in UTC seconds with `Z`.
- [ ] Never write `priority`, `type`, `blocks`, `children`.
- [ ] Append to Log; never rewrite earlier lines.
- [ ] Bump `updated` on every write.
- [ ] Hold the write lock; write via temp file and rename.
- [ ] Refuse to write when `config.yml` `version` is unknown.
