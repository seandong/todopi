# `--json` output

Every command that reports something accepts the global `--json` flag and then prints **one JSON value** on stdout instead of text. This page is the contract for those values (PRD FR-Q3). It is checked against the source: `make check` (architecture rule ARCH-028, `tools/check-json-doc.mjs`) compiles every type below against the TypeScript type the command serializes and fails if a field, its type or its optionality differs.

## General rules

- **stdout carries exactly one JSON value**, pretty-printed, followed by a newline. Notes, warnings, progress and errors go to **stderr** as text, never into stdout.
- **Exit codes** are the same as without `--json` (FR-Q2): `0` success · `1` usage or validation error · `2` gate refused · `3` conflict (lease held, concurrent write) · `4` unsupported format version (the ledger is newer than this todopi; reads still work, writes exit 4).
- On an error (exit `1`, `3` or `4` outside a gate refusal) stdout is **empty** and the message is on stderr. A refused `done` / `close` / `reopen` is the exception: it prints a [`GateReport`](#gatereport) on stdout and exits `2` or `3`.
- **Optional fields** (marked `?` below) are **omitted** when absent; they are never `null`. A field whose type includes `null` is always present.
- **Timestamps** are strings in UTC, `YYYY-MM-DDTHH:MM:SSZ` (spec §5.2).
- **Field names** are frozen as they are. Most follow the ledger's snake_case (`blocked_by`, `log_total`); some reports added later use camelCase (`primedAt`, `logOmitted`). Renaming either would be a breaking change, so both stay.

## Compatibility

The `--json` output is versioned with the CLI (npm package `todopi`):

- **Additive changes** may ship in any release: a new field, a new optional field, a new report for a command that had none. Consumers must ignore fields they do not know.
- **Breaking changes** bump the CLI's **major version**: removing or renaming a field, changing its type, making an optional field required or a required one optional, changing what a field means, adding a value to a field whose type is a closed list of values (such as `InitReport.agents`), or changing which report a command prints.
- **Before 1.0**, the leftmost non-zero part of the version is the major version: a breaking change goes from `0.1.x` to `0.2.0`, never to `0.1.(x+1)`.
- A field typed `string` whose values are listed only in its description (such as `TaskDto.status`) may gain values in a minor release when the ledger format itself gains them; the format's own versioning (spec §9) governs that.

## Which command prints which report

| Command | `--json` prints |
|---|---|
| `doctor` | [`DoctorReport`](#doctorreport) |
| `doctor --fix` | [`DoctorFixReport`](#doctorfixreport) |
| `init` | [`InitReport`](#initreport) |
| `add` (`new`, `create`) | [`AddReport`](#addreport) |
| `ls` (`list`), `ready` | an array of [`TaskDto`](#taskdto) — tasks that are not valid v1 files are reported on stderr, not in the array |
| `show` | [`ShowDto`](#showdto) |
| `prime` | [`PrimeReport`](#primereport) |
| `prime --full` | [`PrimeFullReport`](#primefullreport) |
| `handoff` | [`HandoffReport`](#handoffreport) |
| `setup <agent>` | [`SetupReport`](#setupreport) |
| `note` (`log`) | [`NoteReport`](#notereport) |
| `check` | [`CheckReport`](#checkreport) |
| `edit` | [`EditReport`](#editreport) |
| `move` | [`MoveReport`](#movereport) |
| `dep add`, `dep rm` (`block`) | [`DepReport`](#depreport) |
| `claim` | [`ClaimReport`](#claimreport) |
| `release` | [`ReleaseReport`](#releasereport) |
| `done` (`finish`, `complete`), `close` (`cancel`), `reopen` | [`TransitionReport`](#transitionreport); when a gate refuses, [`GateReport`](#gatereport) and exit `2` or `3` |
| `import <plan.md>` | [`ImportReport`](#importreport) |
| `import beads [path]` | [`ImportBeadsReport`](#importbeadsreport) |

Not covered: `web` serves a page and has no `--json` output; `prime --hook-json <shape>` prints the hook JSON the named agent expects (its format belongs to that agent); `prime --hook` and `handoff --hook` print nothing when there is no ledger, and `prime --if-compacted` prints nothing when there was no compaction.

## Reports

Types are written in TypeScript notation. `A & B` means an object with the fields of both.

### `DoctorReport`

| Field | Type | Meaning |
|---|---|---|
| `ok` | `boolean` | `true` when there are no findings (warnings do not count) |
| `scanned` | `number` | task files read |
| `findings` | `FindingDto[]` | violated invariants; any finding makes `doctor` exit `1` |
| `warnings` | `FindingDto[]` | notes that do not fail `doctor` (currently: unknown frontmatter keys, spec §5.2) |

### `FindingDto`

| Field | Type | Meaning |
|---|---|---|
| `rule` | `string` | the invariant or rule id, such as `invariant-2` |
| `path` | `string` | file the finding is about, relative to the project root |
| `message` | `string` | what is wrong |

### `DoctorFixReport`

| Field | Type | Meaning |
|---|---|---|
| `fixed` | `{ path: string; changes: string[] }[]` | files rewritten, with what was normalized in each |
| `skipped` | `{ path: string; reason: string }[]` | files that needed a fix but could not be rewritten safely |
| `leasesCleared` | `string[]` | ids whose leftover lease was removed |
| `after` | `DoctorReport` | the check run after fixing; `doctor --fix` exits `1` when `after.ok` is `false` |

### `InitReport`

| Field | Type | Meaning |
|---|---|---|
| `root` | `string` | absolute path of the project that holds the ledger |
| `created` | `string[]` | files created, relative to `root` |
| `kept` | `string[]` | files that already existed and were left alone |
| `agents` | `"created" \| "appended" \| "replaced" \| "unchanged"` | what happened to `AGENTS.md` |

### `AddReport`

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | the new task's id |
| `title` | `string` | |
| `path` | `string` | the task file, relative to the project root |
| `rank` | `string` | its place in the queue |

### `TaskDto`

One task as listed by `ls`, and the base of [`ShowDto`](#showdto).

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | |
| `title` | `string` | |
| `status` | `string` | `open`, `in_progress` or `closed` (spec §5.2) |
| `resolution?` | `string` | `done`, `wontfix`, `duplicate` or `obsolete`; only on closed tasks |
| `assignee?` | `string` | actor who holds the task |
| `parent?` | `string` | id of the parent task |
| `blocked_by` | `string[]` | ids this task waits for |
| `rank?` | `string` | queue position; absent on files that have none |
| `labels` | `string[]` | |
| `created` | `string` | timestamp |
| `updated` | `string` | timestamp |
| `ready` | `boolean` | derived (spec §7.5): no children, not blocked, and open — or in progress but stale |
| `blocked` | `boolean` | derived (spec §7.2): not closed, and waits for a task that is not closed |
| `stale` | `boolean` | derived (spec §7.3): in progress, and its lease heartbeat (or, without a local lease, `updated`) is older than `lease_hours` |
| `mine` | `boolean` | held by the current actor |
| `unverified` | `boolean` | closed with `forced=true` on its last done / closed entry |
| `child_progress?` | `{ closed: number; total: number }` | for a task with children: how many are closed |

### `ShowDto`

`TaskDto` plus the body.

| Field | Type | Meaning |
|---|---|---|
| (all of `TaskDto`) | | |
| `verify?` | `string` | the verify command |
| `external?` | `Record<string, unknown>` | the `external` frontmatter mapping, as written |
| `description?` | `string` | the Description section |
| `plan?` | `string` | the Plan section |
| `acceptance` | `{ n: number; text: string; checked: boolean }[]` | acceptance criteria, numbered as `check <id> <n>` uses them |
| `acceptance_notes?` | `{ after: number; text: string }[]` | non-criterion text in Acceptance Criteria; `after` is the number of the criterion it follows (0 = before the first); omitted when there is none |
| `log` | `LogEntryDto[]` | the Log entries shown (the last 5, or all with `--full`), oldest first |
| `log_total` | `number` | entries in the whole Log |
| `tree?` | `{ ancestors: TreeNodeDto[]; children: TreeNodeDto[]; cycle: boolean }` | only with `--tree`: ancestors from the root down, direct children, and whether walking up the parents looped |

The check compiles this table as `TaskDto & { …the fields above… }`.

### `LogEntryDto`

A Log entry that parses (spec §5.3.3) is split into fields; one that does not is given verbatim.

```ts
type LogEntryDto =
  | { timestamp: string; actor: string; verb: string; args: Record<string, string>; text?: string }
  | { malformed: true; raw: string };
```

### `TreeNodeDto`

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | |
| `missing?` | `true` | the id a `parent` points to does not exist; the other fields are then absent |
| `title?` | `string` | |
| `status?` | `string` | |
| `resolution?` | `string` | |
| `child_progress?` | `{ closed: number; total: number }` | |

### `PrimeReport`

| Field | Type | Meaning |
|---|---|---|
| `held` | `PrimeTask[]` | the caller's in-progress tasks, most recently updated first, as many as fit the budget |
| `moreHeld` | `number` | held tasks that did not fit |
| `ready` | `number` | tasks ready to claim |
| `heldByOthers` | `number` | tasks in progress under other actors |
| `budget` | `number` | the token budget used |
| `truncated` | `boolean` | something was left out to fit the budget |
| `overBudget` | `boolean` | still over budget after trimming everything that can be trimmed |
| `moreHeldLine` | `string \| null` | the "N more tasks you hold" line, or `null` |
| `pointer` | `string` | the last line of the text output, verbatim |
| `commands` | `string[]` | the commands mentioned in `pointer` and `moreHeldLine`, in order |

### `PrimeTask`

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | |
| `title` | `string` | |
| `acceptance` | `{ n: number; text: string; checked: boolean }[]` | criteria pushed to the agent; checked ones dropped to fit are counted in `checkedOmitted` |
| `checkedOmitted` | `number` | |
| `acceptanceTotal` | `number` | all checkbox criteria of the task; `0` when it has none |
| `seeAlso` | `string \| null` | when the task has no checkbox criteria, where to read its prose criteria; otherwise `null` |
| `log` | `string[]` | the most recent Log entries, oldest first, each with its continuation lines |
| `logOmitted` | `number` | recent entries left out to fit the budget |

### `PrimeFullReport`

| Field | Type | Meaning |
|---|---|---|
| `held` | `PrimeTask[]` | |
| `heldByOthers` | `{ id: string; title: string; assignee: string }[]` | |
| `ready` | `{ id: string; title: string }[]` | the first ready tasks, in queue order |
| `readyTotal` | `number` | |
| `readyMore` | `{ count: number; command: string } \| null` | when more are ready than listed: how many, and the command that lists them |
| `counts` | `{ open: number; in_progress: number; ready: number; blocked: number; closed: number }` | |
| `recentlyClosed` | `{ id: string; title: string; resolution: string }[]` | |

### `HandoffReport`

| Field | Type | Meaning |
|---|---|---|
| `actor` | `string` | |
| `primedAt` | `string \| null` | when this session (or actor) last ran `prime`; `null` if never |
| `quiet` | `(HandoffTaskRef & { assignee: string; lastLogAt: string \| null })[]` | the caller's in-progress tasks with no Log entry in the last hour |
| `created` | `HandoffTaskRef[] \| null` | tasks the caller created since the last `prime`; `null` without a baseline |
| `verifyChanged` | `(HandoffTaskRef & { verify: string \| null; state: HandoffVerifyState })[] \| null` | tasks whose verify command appeared or changed since the last `prime` (anyone's); `null` without a baseline |
| `logged` | `(HandoffTaskRef & { summary: string })[]` | tasks a `handoff` entry was appended to (empty with `--check`) |
| `skipped` | `(HandoffTaskRef & { reason: string })[]` | tasks that were no longer the caller's when the write happened |
| `failed` | `(HandoffTaskRef & { message: string; code: number })[]` | tasks the entry could not be written to |
| `check` | `boolean` | `--check` was given: nothing was written |
| `baselineNote` | `string \| null` | why `created` or `verifyChanged` is `null`; otherwise `null` |

### `HandoffTaskRef`

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | |
| `title` | `string` | |

### `HandoffVerifyState`

`new`: appeared after the last `prime`; `changed`; `removed`; `edited`: same value as at `prime`, but changed and changed back through the CLI in between; `unreadable`: the task file or its verify value cannot be read; `unknown`: could not be read at `prime` time, so there is nothing to compare with.

```ts
type HandoffVerifyState = "new" | "changed" | "removed" | "edited" | "unreadable" | "unknown";
```

### `SetupReport`

| Field | Type | Meaning |
|---|---|---|
| `agent` | `string` | |
| `scope` | `"project" \| "user"` | |
| `files` | `{ path: string; status: "created" \| "updated" \| "appended" \| "unchanged" }[]` | every file setup looked at and what it did |
| `notes` | `string[]` | hints that are printed as text without `--json` |

### `NoteReport`

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | |
| `title` | `string` | |
| `text` | `string` | the note as appended |

### `CheckReport`

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | |
| `n` | `number` | the criterion's number |
| `text` | `string` | |
| `checked` | `boolean` | the state asked for: `true` for `check`, `false` for `check --undo` |
| `changed` | `boolean` | `false` when it already was in that state and nothing was written |

### `EditReport`

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | |
| `fields` | `string[]` | fields that actually changed, sorted; empty when nothing was written |

### `MoveReport`

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | |
| `rank` | `string` | the rank after the move |
| `changed` | `boolean` | `false` when the task already was there |

### `DepReport`

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | the task that waits |
| `op` | `"add" \| "rm"` | |
| `on` | `string` | the task it waits for |
| `changed` | `boolean` | `false` when the edge already existed (`add`) or did not exist (`rm`) |

### `ClaimReport`

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | |
| `title` | `string` | |
| `status` | `string` | |
| `assignee` | `string` | |
| `replaced?` | `string` | the actor this claim replaced (`--steal`) |
| `stolen` | `boolean` | the claim replaced another actor's assignment |
| `refreshed` | `boolean` | the caller already held the task: only its lease was refreshed, nothing logged |

### `ReleaseReport`

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | |
| `title` | `string` | |
| `status` | `string` | |

### `TransitionReport`

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | |
| `title` | `string` | |
| `status` | `string` | |
| `resolution?` | `string` | |
| `forced` | `boolean` | the gates were overridden with `--force` |

### `GateReport`

Printed instead of a `TransitionReport` when `done`, `close` or `reopen` is refused. Every failed gate is listed, not just the first.

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | |
| `title` | `string` | |
| `transition` | `Transition` | |
| `refused` | `Refusal[]` | every gate that failed |
| `code` | `number` | the exit code: `3` when ownership failed, otherwise `2` |
| `actions` | `GateAction[]` | what to do next, per gate |

### `Transition`

```ts
type Transition = "done" | "close" | "reopen";
```

### `Refusal`

One failed gate. `gate` tells which one, and the other fields depend on it.

```ts
type Refusal =
  | { gate: "ownership"; code: 3; holder: string; heldSince: string }
  | { gate: "acceptance"; code: 2; unchecked: Criterion[] }
  | { gate: "children"; code: 2; open: Array<{ id: string; title: string; status: string }> }
  | { gate: "state"; code: 2; status: string; transition: Transition }
  | {
      gate: "verify"; code: 2;
      command: string; exitCode: number | null; signal: string | null; timedOut: boolean;
      tail: string; logPath: string; logProblem: string | null;
    };
```

For `verify`: `tail` is the end of the output, `logPath` the file that holds all of it, and `logProblem` says why that file could not be written (then `logPath` should not be read), otherwise `null`.

### `Criterion`

| Field | Type | Meaning |
|---|---|---|
| `n` | `number` | the criterion's number |
| `text` | `string` | |
| `checked` | `boolean` | |
| `line` | `number` | its line in the task body |

### `GateAction`

Exactly one of `command` and `template` is present.

| Field | Type | Meaning |
|---|---|---|
| `for` | `"ownership" \| "acceptance" \| "children" \| "state" \| "verify" \| "retry" \| "force"` | the gate this action addresses; `retry` and `force` are the two ways out at the end |
| `command?` | `string` | a complete command line that can be run as is |
| `template?` | `string` | a command with `<…>` placeholders to fill in |
| `detail` | `string` | one sentence on what the action does |

### `ImportReport`

| Field | Type | Meaning |
|---|---|---|
| `source` | `string` | the imported file as recorded in the Log: relative to the project root (absolute outside it), whitespace and `%` percent-encoded |
| `created` | `{ id: string; title: string; status: string; resolution?: string; parent?: string }[]` | tasks created, in document order |
| `existing` | `number` | tasks already imported from the same source and left alone |
| `warnings` | `{ line: number; message: string }[]` | |

### `ImportBeadsReport`

| Field | Type | Meaning |
|---|---|---|
| `source` | `string` | as in `ImportReport` |
| `created` | `{ id: string; beads_id: string; title: string; status: string; resolution?: string }[]` | tasks created, with the Beads id each came from |
| `skipped` | `{ tombstone: number; ephemeral: number; already_imported: number }` | |
| `dropped` | `{ dangling_edges: number; other_edge_types: number; cycle_edges: number; from_edges: number; extra_parents: number; comments: number }` | what todopi has no place for, or that pointed at entries not imported |
| `warnings` | `string[]` | |
