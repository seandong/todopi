# The `.todopi/` Format, Version 1

Status: Stable · 2026-09-16
Applies to: `version: 1` in `.todopi/config.yml`

This document specifies the on-disk format that todopi reads and writes. It is written so that a third-party tool can read and write a `.todopi/` directory without the todopi CLI. The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as described in RFC 2119.

Three documents describe this format, and they rank:

| | |
|---|---|
| **This document** | Normative. It defines the format; on any disagreement it wins. |
| [`fixtures/`](fixtures/README.md) | This document in executable form — sample files with their expected parses. A disagreement with this document is a bug in one of them, and they are fixed together. |
| [`IMPLEMENTING.md`](IMPLEMENTING.md) | Advisory. Reasoning, suggested order of work, and the mistakes implementations actually make. It introduces no requirement. |

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
- `.cache/` holds derived data (indexes, captured command output, leases when there is no `.git/`). Its contents are not part of the format; nothing in it may be needed to reconstruct state.
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

There is deliberately no key for identity and no key for trust. Identity is a property
of a person and a machine, not of a repository, and `config.yml` is committed: a value
here would apply to every clone. Trust for `verify` commands is covered in §8.

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
- **Writers MUST quote every scalar value with double quotes**, escaping `\` as `\\` and `"` as `\"`, and MUST write lists in flow style with each element quoted the same way (`labels: ["auth", "web"]`; an empty list is `[]`). This applies to every value a writer emits, including ones that look like plain words.

  This rule exists because YAML infers a type from an unquoted scalar, and task titles routinely defeat that inference. `title: feat: add login` is a parse error that makes the whole file unreadable. `title: fix #42` silently becomes `fix`, because `#` opens a comment. `rank: 007` becomes the integer `7`, and writing it back loses the leading zeros the ordering depends on. `title: null` becomes no title at all. None of these are exotic: a task title that mirrors a commit subject contains a colon by convention, and issue references contain `#`.

  Quoting removes the ambiguity rather than enumerating the cases. It also makes the frontmatter a regular sub-language — every value is a quoted string or a flow list of quoted strings — which a reader may exploit with a simple scanner, falling back to a full YAML parser for any line that departs from that shape.

  Readers MUST NOT require quoting: a file written by hand is still valid YAML and MUST be read as such. `doctor --fix` normalizes such files.

### 5.2 Frontmatter fields

Twelve fields are defined. Four are always required.

Twelve fields, thirteen YAML keys: `created` and `updated` are one field family that
always appears as a pair. No other field maps to more than one key.

The Type column below describes the value's meaning, not its YAML spelling: writers
quote every scalar (§5.1), so `rank: "007"` and `created: "2026-09-14T09:00:00Z"` are
strings on disk and a reader converts them as this table directs.

| # | Field | Type | Required | Constraints |
|---|---|---|---|---|
| 1 | `id` | string | yes | §4; MUST equal the file name minus `.md` |
| 2 | `title` | string | yes | single line, 1–200 characters after trimming |
| 3 | `status` | enum | yes | `open` · `in_progress` · `closed` |
| 4 | `resolution` | enum | iff `status: closed` | `done` · `wontfix` · `duplicate` · `obsolete`; MUST be absent when status is not `closed` |
| 5 | `assignee` | string | iff `status: in_progress` | an actor string (§5.4); MAY be present when `closed` (who closed it); MUST be absent when `open` |
| 6 | `parent` | id | no | MUST reference an existing task; MUST NOT equal `id`; the parent chain MUST be acyclic |
| 7 | `blocked_by` | list of id | no | each MUST reference an existing task; MUST NOT contain `id`; the blocked-by graph MUST be acyclic; empty list is equivalent to absent |
| 8 | `rank` | string | no | `^[0-9a-z]{1,32}$`; writers assign one at creation; see §7.4 |
| 9 | `verify` | string | no | a shell command line, run from the repository root |
| 10 | `labels` | list of string | no | each `^[a-z0-9][a-z0-9_.-]{0,31}$`; no duplicates |
| 11 | `external` | mapping | no | keys are system names (`linear`, `github`, `beads`, …); values are mappings; writers MUST preserve entries they do not understand |
| 12 | `created` / `updated` | timestamp | yes | RFC 3339, UTC, second precision, `Z` suffix, e.g. `2026-09-14T09:00:00Z`; `updated` ≥ `created` |


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
- `<key>=<value>`: `key` is `[a-z_]+`; `value` is `[^\s]+` (no spaces). Order is not significant. Every space-separated token after the verb and before any `: ` MUST be of this form; a token that is not is a malformed line. This is what makes the grammar checkable: because the fields are positional, a defect in an earlier field surfaces as a structural fault later in the line — an actor containing a space, for instance, shifts the verb one field to the right and leaves a bare word where only a `key=value` pair may stand.
- `<text>`: free text to end of line. A multi-line text continues on following lines indented by two spaces; readers join them with `\n`.

Verbs and their arguments:

| Verb | Arguments | Emitted by |
|---|---|---|
| `created` | `from=<id>` (optional; the task being worked on when this one was discovered) · `source=<path>` (optional) | `add`, `import` |
| `claimed` | `steal=true` (optional; set whenever the claim replaced another actor's `assignee`, whether or not that actor's lease had expired) · text = the replaced actor | `claim` |
| `released` | — | `release` |
| `note` | — (text required) | `note`, `handoff` |
| `check` / `uncheck` | `ac=<n>` · text = the criterion's text as it read at the time of the event, truncated to 80 characters | `check` |
| `done` | `verify=pass\|fail\|none` · `commit=<sha7>` · `dirty=true\|false` · `forced=true` (only when forced; text = reason, optionally followed by verify output as indented continuation lines) | `done` |
| `closed` | `resolution=wontfix\|duplicate\|obsolete` · `forced=true` (when a gate was bypassed) | `close` |
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
- 2026-09-14T10:41:00Z claude-code@mbp check ac=1: Existing passkey users can sign in
- 2026-09-14T11:02:00Z claude-code@mbp done verify=pass commit=3f2a1c9 dirty=true
```

A closed task whose most recent `done` or `closed` event carries `forced=true` is displayed as "unverified".

What MUST NOT be appended:

- **A transition that was refused.** If a gate rejects `done` or `close`, no state
  changed, so nothing is appended. The Log records the history of the task, not the
  attempts made against it. A worker that wants to record a failed attempt uses `note`.
- **The output of a `verify` command that passed.** The `verify` field records what was
  run and the `commit` argument records against what; the output itself adds no
  information a reader can act on, and it is the largest thing that would ever enter a
  task file. Full output belongs in `.cache/` (§2), which is not committed. Only a
  forced close MAY carry output, because that is the case a human must review, and then
  only the last 512 bytes.

### 5.4 Actor strings

An actor identifies who performed a write. It appears in `assignee` (§5.2) and in every
Log line (§5.3.3), and MUST match `^[^\s:]{1,64}$`.

- An actor identifies a **worker, not a session**. The same tool on the same machine
  MUST produce the same actor string across sessions, so that a later session can
  continue the work an earlier one claimed without being treated as a different worker.
  Session identity is runtime state and never appears in a task file (§8).
- The conventional shapes are `<tool>@<host>` for an automated worker
  (`claude-code@mbp`) and a bare name for a person (`sean`).
- A value taken from an external source — a version-control user name, for instance —
  MUST be normalized before use: lowercased, runs of whitespace replaced by `-`,
  characters outside `[a-z0-9_.@+-]` removed, truncated to 64 characters, and rejected
  if the result is empty. Normalization is required, not advisory: such values commonly
  contain spaces, and a space inside an actor would be read as a field separator and
  corrupt the Log line.

## 6. State

### 6.1 Stored states and transitions

| From | To | Command | Effects |
|---|---|---|---|
| `open` | `in_progress` | `claim` | set `assignee`; create lease; log `claimed` |
| `in_progress` | `open` | `release` | clear `assignee`; delete lease; log `released` |
| `in_progress` | `in_progress` | `claim` (reclaim) | replace `assignee`; replace lease; log `claimed steal=true` naming the replaced actor |
| `open`, `in_progress` | `closed` (`done`) | `done` | run `verify` if present; require Acceptance Criteria satisfied; require every child `closed`; set `resolution: done`; delete lease; log `done` |
| `open`, `in_progress` | `closed` (other) | `close --as` | require every child `closed`; set `resolution`; delete lease; log `closed` |
| `closed` | `open` | `reopen` | remove `resolution` and `assignee`; log `reopened` |

Reclaim exists because §7.5 places a stale `in_progress` task in the ready queue: a
queue that offers a task and a claim that then refuses it would contradict each other.
A reclaim of a task whose lease has expired needs no extra ceremony; overriding a lease
that is still live is what `--steal` is for. Either way the replacement of another
actor's `assignee` is what `steal=true` records.

Gates. A transition MUST be refused when: `verify` exits non-zero; the Acceptance
Criteria are unsatisfied; some child is not `closed`; or the task's `assignee` is
another actor. Any of these MAY be forced with `--force --reason <text>`, which MUST
record `forced=true` and the reason in the Log. A refused transition changes nothing
and MUST NOT append to the Log (§5.3.3).

Writes that are not transitions — appending a note, toggling a criterion, editing a
field — MUST also be refused when the task's `assignee` is another actor, so that two
workers cannot interleave writes on one task.

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
8. Every `assignee` and every Log actor conforms to §5.4.

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

Writers MUST assign a `rank` when they create a task, ordered after the last ranked
task. In a set written only by conforming tools, group 2 is therefore empty and the
order is a single dimension. Group 2 exists to tolerate files written by hand or by
tools that omit `rank`; a repair pass (`doctor --fix`) SHOULD backfill those in
`created` order rather than leaving two populated groups, because a task that acquires
a rank jumps ahead of every unranked task regardless of the value chosen.

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

The lease directory is also where other machine-local runtime state belongs — per-session
bookkeeping such as the time of each session's last context-injection call. None of it is
part of the format and all of it MAY be deleted at any time.

Trust for `verify` commands MUST NOT be stored anywhere inside `.todopi/`. A trust record
that travels with the repository lets a repository certify itself, which defeats the point
of asking. It belongs in user-level configuration outside any repository.

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
id: "tp-a1b2c3"
title: "feat: support passkeys on /login (#42)"
status: "in_progress"
assignee: "claude-code@mbp"
parent: "tp-9f00k2"
blocked_by: ["tp-7c21xx"]
rank: "a0m"
verify: "pnpm test -- login"
labels: ["auth"]
created: "2026-09-14T09:00:00Z"
updated: "2026-09-14T10:41:00Z"
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
- 2026-09-14T10:41:00Z claude-code@mbp check ac=1: Existing passkey users can sign in
```

## 11. Conformance checklist for third-party writers

- [ ] Preserve unknown frontmatter keys, `x-*` keys, unknown Log verbs, unrecognized body sections.
- [ ] Emit frontmatter keys in §5.2 order; timestamps in UTC seconds with `Z`.
- [ ] Never write `priority`, `type`, `blocks`, `children`.
- [ ] Quote every scalar value and every list element with double quotes (§5.1).
- [ ] Assign a `rank` when creating a task.
- [ ] Normalize actor strings (§5.4); never emit one containing whitespace or `:`.
- [ ] Append to Log; never rewrite earlier lines, and never append for a refused transition.
- [ ] Bump `updated` on every write.
- [ ] Hold the write lock; write via temp file and rename.
- [ ] Refuse to write when `config.yml` `version` is unknown.
