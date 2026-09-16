# Implementing the `.todopi/` Format

Status: advisory · 2026-09-16

This document is **not normative**. It explains reasoning and suggests an order of work;
it introduces no requirement of its own. Where it appears to disagree with
`todopi-format-v1.md`, the specification wins and this document has a bug.

```
todopi-format-v1.md   normative — the definition
fixtures/             the specification in executable form — must agree with it
IMPLEMENTING.md       advisory — why, and in what order (this file)
```

The format is deliberately small: one directory, one config file, one Markdown file per
task, twelve frontmatter fields. A complete reader is a few hundred lines. Most of the
difficulty is in three places, and they are not the places that look difficult.

---

## Build it in this order

**1. Read and validate.** Parse `tasks/*.md` into memory and check the invariants of §6.2.
Nothing else depends on writing, and a reader can be verified against `fixtures/` before
any of your own data exists.

**2. Derive.** Compute `children`, `blocks`, `blocked`, `stale`, ordering, and `ready`
(§7). These are pure functions of the task set — no clock beyond `now`, no filesystem.
Keep them that way; it is what makes them cheap to test exhaustively.

**3. Write.** The emitter, atomic replacement, and `updated` bookkeeping (§5.1, §6.3).
Get the emitter correct before making it fast: a round-trip failure corrupts data,
whereas slowness annoys.

**4. Lock and lease.** Mutual exclusion (§8). Last, because it is only needed once two
writers can meet, and because it is the part whose bugs are hardest to reproduce.

A reader alone is already useful — a dashboard, an editor extension, a status line in a
prompt. Nothing obliges you to implement writing at all.

---

## The three things that actually go wrong

### YAML will reinterpret your titles

This is the most common defect, and it is silent.

An unquoted YAML scalar gets a type inferred from its shape, and task titles routinely
defeat the inference:

| Written | Read back as | Consequence |
|---|---|---|
| `title: feat: add login` | parse error | the whole file becomes unreadable |
| `title: fix #42` | `"fix"` | `#` opens a comment; the title is truncated |
| `rank: 007` | `7` | ordering breaks; the leading zeros are gone |
| `title: 1.20` | `1.2` | the trailing zero disappears on write-back |
| `title: null` | `null` | the task has no title |
| `title: no` | `"no"` | safe in YAML 1.2, a boolean under YAML 1.1 — check your library |

None of these are contrived. A task is meant to be about one commit's worth of change, so
its title tends to read like a commit subject, and commit subjects contain colons by
convention and issue numbers by habit.

§5.1 therefore requires writers to quote every scalar and every list element. The rule
removes the ambiguity rather than enumerating its cases — including the ones neither of us
has thought of. Readers still accept unquoted files, because humans write them by hand.

A useful consequence for readers: once every value a conforming writer emits is a quoted
string or a flow list of quoted strings, the frontmatter is a regular sub-language. You can
scan it directly and reach for a full YAML parser only when a line departs from that shape.
If you do this, assert on every fixture that both paths agree.

### Unknown keys are someone's data

§5.2 requires writers to preserve keys they do not recognize — unknown keys, `x-*`
extension keys, unknown Log verbs, unrecognized body sections.

The reason is concrete rather than theoretical. A file may have been written by a later
revision of the format, or by a tool that tracks something yours does not. Dropping those
keys on write-back deletes data that belongs to someone else, and does it silently. It is
also what makes the format extensible without a version bump (§9): new optional keys are
additive precisely because older readers keep them.

The practical difficulty is that an unknown key's value may be an arbitrary YAML structure,
including an indented block. If you scan the frontmatter rather than parse it, you still
have to carry such blocks through verbatim. `fixtures/valid/unknown-keys.md` is the case
to test against.

### The Log is evidence, so it is append-only

§5.3.3 forbids modifying or reordering earlier Log lines. No exception — not to normalize a
timestamp, not to fix a line that fails to parse. A repair tool that may rewrite history
makes the history worthless, and this history is what the format offers as evidence that a
task was actually finished.

Two consequences that are easy to get wrong:

- A **refused** transition appends nothing. Nothing changed, so nothing happened. Only a
  transition that took effect is an event.
- An unparseable Log line is **reported**, never repaired.

The grammar has a multi-line form: continuation lines are indented by two spaces and joined
with `\n`. `fixtures/valid/log-grammar.md` covers every shape including an unknown verb.

---

## Smaller things worth knowing before you hit them

**Bump `updated` on every write.** Including writes that only touch the body — a note, a
checkbox. `updated` doubles as the cross-machine heartbeat behind stale detection (§6.3,
§7.3), so a write that does not bump it makes a live task look abandoned.

**Normalize actor strings.** The obvious default for a human actor is the version-control
user name, and those routinely contain spaces, which §5.4 forbids. A space inside an actor
is read as a field separator and corrupts the Log line it appears in. Lowercase, replace
whitespace runs with `-`, strip what remains outside the allowed set, truncate to 64.

**An actor identifies a worker, not a session.** If a new session produces a new actor
string, continuing yesterday's own task looks like stealing it from a stranger.

**Assign a `rank` when you create a task.** Ordering puts ranked tasks before unranked ones
(§7.4), so a task that acquires a rank jumps ahead of every task without one. If some of
your tasks have ranks and some do not, "move X after Y" has no solution.

**Leases are advisory and machine-local.** The durable record is the committed
`status`/`assignee`/`updated` triple. A lease file is an optimization for the case where
two processes on one machine would otherwise collide; a reader that ignores leases entirely
is still correct.

**Refuse to write a version you do not implement**, but still read it (§9). The format is
designed so a v1 reader degrades gracefully on a file from a later revision — provided it
does not write that file back with the parts it did not understand removed.

---

## Checking your work

Run `fixtures/` (see its README). Fourteen valid files with expected parses, nine invalid
files with the rule each violates.

Beyond that, two properties are worth asserting on your own data, because they catch what
example-based tests do not:

- **Round-trip.** For any task, `write(read(f))` reparses to the same value. This catches
  the quoting and preservation defects above in one assertion.
- **Ordering is total.** For any set of tasks, the §7.4 order is deterministic and
  independent of the order the files were read in.

If you implement this format, the corpus is the place to contribute the case that caught
you. A fixture documenting a mistake a real implementation made is worth more than one
constructed to be hard.
