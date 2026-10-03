---
id: "tp-nxy1hu"
title: "Release todopi 0.2.0"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j09"
verify: "make check && make test && make e2e"
created: "2026-10-03T04:07:23Z"
updated: "2026-10-03T04:41:01Z"
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
- 2026-10-03T04:33:15Z claude-code@Seans-MacBook-Pro.local note: Release review No-Go addressed by making npm the README default while the repository remains private. The final acceptance criterion is post-tag evidence and will be checked only after npm, GitHub Release and remote CI succeed. Tag will be created only on the exact validated main commit after main Harness/Install pass; no visibility change.
- 2026-10-03T04:41:01Z claude-code@Seans-MacBook-Pro.local note: Second subagent review found private raw curl command still could not authenticate even for someone with repository access; removed it. README now states npm is public, GitHub raw/Release assets require authenticated access while private, and no unsupported shell command is offered.
