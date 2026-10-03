---
id: "tp-nxy1hu"
title: "Release todopi 0.2.0"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j09"
verify: "make check && make test && make e2e"
created: "2026-10-03T04:07:23Z"
updated: "2026-10-03T04:09:56Z"
---

## Description

Ship the Cargo-style CLI output and init --setup improvements published since 0.1.0; validate the packaged CLI in a fresh repository and the tag-driven npm/GitHub Release.

## Acceptance Criteria

- [ ] Version, lockfile, generated agent manifests and changelog match 0.2.0.
- [ ] All local checks and a packed npm install in an isolated new repository pass, including init --setup and diagnostic output.
- [ ] The v0.2.0 tag points at the validated main commit; npm and Release artifacts publish successfully and remote CI passes.

## Log

- 2026-10-03T04:07:23Z claude-code@Mac created
- 2026-10-03T04:09:56Z claude-code@Seans-MacBook-Pro.local claimed
