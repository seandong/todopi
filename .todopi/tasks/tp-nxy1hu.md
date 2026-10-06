---
id: "tp-nxy1hu"
title: "Release todopi 0.2.0"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j09"
verify: "make check && make test && make e2e"
created: "2026-10-03T04:07:23Z"
updated: "2026-10-06T03:22:43Z"
---

## Description

Ship the Cargo-style CLI output and init --setup improvements published since 0.1.0; validate the packaged CLI in a fresh repository and the tag-driven npm/GitHub Release.

## Acceptance Criteria

- [x] Version, lockfile, generated agent manifests and changelog match 0.2.0.
- [x] All local checks and a packed npm install in an isolated new repository pass, including init --setup and diagnostic output.
- [x] The v0.2.0 tag points at the validated main commit; npm and Release artifacts publish successfully and remote CI passes.

## Log

- 2026-10-03T04:07:23Z claude-code@Mac created
- 2026-10-03T04:09:56Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-10-03T04:33:15Z claude-code@Seans-MacBook-Pro.local note: Release review No-Go addressed by making npm the README default while the repository remains private. The final acceptance criterion is post-tag evidence and will be checked only after npm, GitHub Release and remote CI succeed. Tag will be created only on the exact validated main commit after main Harness/Install pass; no visibility change.
- 2026-10-03T04:41:01Z claude-code@Seans-MacBook-Pro.local note: Second subagent review found private raw curl command still could not authenticate even for someone with repository access; removed it. README now states npm is public, GitHub raw/Release assets require authenticated access while private, and no unsupported shell command is offered.
- 2026-10-03T04:54:07Z claude-code@Seans-MacBook-Pro.local note: Third subagent review found brew tap alone cannot install private Release binaries, and an old ~/.local/bin copy can shadow the new npm global CLI. README now requires publicly downloadable Release assets for brew and directs users to verify command -v todopi and --version on the agent PATH.
- 2026-10-06T03:22:30Z claude-code@Seans-MacBook-Pro.local note: Published v0.2.0 at tag target 6fa0d4b (remote tag peeled SHA verified). Main Harness 37098785798 and Install 37098785838 passed before tag. Tag-triggered Release 37406508070, Harness 37406508071, Install 37406508057 all passed. npm view todopi@0.2.0 shows the public package; isolated registry install ran --version 0.2.0, init --setup claude and doctor. GitHub Release has seven assets; all four binary tarballs match SHA256SUMS, npm tarball SHA512 matches registry dist.integrity. Homebrew tap update skipped (no token); repository remains private.
- 2026-10-06T03:22:42Z claude-code@Seans-MacBook-Pro.local check ac=1: Version, lockfile, generated agent manifests and changelog match 0.2.0.
- 2026-10-06T03:22:43Z claude-code@Seans-MacBook-Pro.local check ac=2: All local checks and a packed npm install in an isolated new repository pass, in
- 2026-10-06T03:22:43Z claude-code@Seans-MacBook-Pro.local check ac=3: The v0.2.0 tag points at the validated main commit; npm and Release artifacts pu
