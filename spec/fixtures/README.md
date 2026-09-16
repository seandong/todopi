# `.todopi/` Format Test Corpus

This directory is the executable form of `../todopi-format-v1.md`. It exists because a
specification written in prose cannot express the cases its author did not think of, and
the cases an implementer trips over are mostly those. Every fixture here corresponds to a
mistake a reasonable implementation makes.

Use it to check an independent reader or writer of the `.todopi/` format. It is plain
data — no runner, no dependency, no need to install todopi. Load the files with whatever
test framework you already use.

## Layout

```
valid/
  <name>.md      a task file that conforms to the specification
  <name>.json    what a conforming reader must produce from it, plus a note
                 explaining which mistake the case is aimed at
invalid/
  <name>.md      a task file that violates the specification
  <name>.json    which rule it violates and why it matters
```

In `valid/*.json`, `frontmatter` holds the expected parse of the frontmatter block, with
timestamps normalized to RFC 3339 strings. Where a fixture tests something else — the Log
grammar, for instance — the JSON carries that assertion instead and has no `frontmatter`
key.

`invalid/` fixtures must be rejected or reported. Some are still well-formed YAML, and
`unterminated-frontmatter.md` is not: an implementation has to fail on both kinds without
silently accepting either. The invariant numbers cited in those files refer to §6.2 of the
specification.

## Suggested use

```
for each file in valid/:
    assert parse(file.md) == file.json.frontmatter
    assert write(parse(file.md)) reparses to the same value      # round-trip
    assert every key in must_preserve_on_write survives a write  # where present

for each file in invalid/:
    assert parse-and-validate(file.md) reports an error
```

The round-trip assertion is the one that catches the most. A reader can look correct while
its writer quietly drops a leading zero, reorders keys, or unquotes a title that then
reparses as something else.

## Stability

Adding a fixture is always allowed and needs no ceremony: a new edge case strengthens
every implementation that runs this corpus.

**Changing the expected value of an existing fixture is a change to the format itself.**
Downstream CI pins to these expectations. Such a change follows the same process as
editing the specification — §9 of the spec governs whether the format version must be
incremented, and the specification and this corpus must change in the same commit. If a
fixture's expectation appears wrong, the specification is wrong too, and both are fixed
together.

## Contributing a case

The useful fixture is the one that documents a real mistake. If an implementation of this
format got something wrong, that case belongs here — it is more valuable than a case
constructed to be difficult. A note explaining what the wrong behaviour was is part of the
fixture.
