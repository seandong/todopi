---
id: "tp-nusvqb"
title: "Release v0.2.2 with verification handoff"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j0k"
verify: "make check && make test && make e2e"
created: "2026-10-13T08:15:24Z"
updated: "2026-10-13T08:51:43Z"
---

## Description

Publish the merged explicit verification-pending handoff feature as a patch release. Keep the format version at 1, verify the npm package and native binary, publish tested main, and validate public artifacts and installation.

## Acceptance Criteria

- [x] Synchronize package, runtime, lockfile, generated integration manifests and release documentation at 0.2.2
- [x] Build and install the candidate npm package and native binary in isolation; pass three local gates and independent review
- [ ] Push the tested main and v0.2.2 tag; verify npm, GitHub Release assets, checksums and tag CI
- [ ] Install the published npm and binary versions in isolation and verify explicit pending handoff without touching personal configuration

## Log

- 2026-10-13T08:15:24Z claude-code@Seans-MacBook-Pro.local created
- 2026-10-13T08:15:31Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-10-13T08:36:36Z claude-code@Seans-MacBook-Pro.local note: Prepared 0.2.2 package/runtime/lockfile and generated integration manifests; documented explicit verification handoff and corrected stale AGENTS.md guidance. Local make check/test/e2e passed. Candidate npm tarball installed under an isolated prefix and native darwin-arm64 binary launched; both report 0.2.2 and show the same pending next step in prime/handoff for its task owner. Main SHA CI and public tag publication remain pending.
- 2026-10-13T08:36:50Z claude-code@Seans-MacBook-Pro.local check ac=1: Synchronize package, runtime, lockfile, generated integration manifests and rele
- 2026-10-13T08:36:50Z claude-code@Seans-MacBook-Pro.local check ac=2: Build and install the candidate npm package and native binary in isolation; pass
- 2026-10-13T08:37:20Z claude-code@Seans-MacBook-Pro.local uncheck ac=2: Build and install the candidate npm package and native binary in isolation; pass
- 2026-10-13T08:40:34Z claude-code@Seans-MacBook-Pro.local note: Review finding resolved in AGENTS.md: prime and handoff are implemented. Release workflow publishes on tag push, so tag only the exact main SHA after its Harness and Install checks succeed; tag CI is post-publication confirmation, not a pre-publication gate. Second independent review pending.
- 2026-10-13T08:41:34Z claude-code@Seans-MacBook-Pro.local check ac=2: Build and install the candidate npm package and native binary in isolation; pass
- 2026-10-13T08:51:43Z claude-code@Seans-MacBook-Pro.local note: Release preparation 71b904d is on main and origin/main; main Harness 38371083972 and Install 38371083981 both succeeded. Attempt to create and push annotated v0.2.2 tag was rejected by Claude Code auto mode: it requires explicit authorization to publish v0.2.2 to public npm. No local or remote tag was created; npm latest remains 0.2.1. Publication, tag CI, public artifacts and public-install criteria are pending; do not claim the release is complete.
