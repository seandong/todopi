---
id: "tp-zapxfh"
title: "Release v0.2.1 with Cursor hook and installer fixes"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j0i"
verify: "make check && make test && make e2e"
created: "2026-10-09T02:25:59Z"
updated: "2026-10-09T02:47:57Z"
---

## Description

Publish the already merged Cursor sessionEnd JSON fix and removed-working-directory installer fix as a patch release. Synchronize version, plugin manifests and user documentation; verify on main and release artifacts. Cursor IDE interactive validation remains a separate open task.

## Acceptance Criteria

- [x] Set package, runtime, lockfile and generated plugin versions to 0.2.1; document the shipped fixes without claiming Cursor IDE validation
- [x] Build and test the versioned npm package and binary, then pass all three local gates and independent review
- [ ] Push tested main and v0.2.1 tag; Release workflow publishes npm and GitHub assets with matching checksums
- [ ] Install the published version in an isolated environment and verify Cursor sessionEnd and installer behavior without changing personal configuration

## Log

- 2026-10-09T02:25:59Z claude-code@Seans-MacBook-Pro.local created
- 2026-10-09T02:26:08Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-10-09T02:35:40Z claude-code@Seans-MacBook-Pro.local note: Prepared 0.2.1 package/runtime/lock and generated six plugin manifests, updated changelog and current docs. make check/test/e2e passed; npm pack produced todopi-0.2.1.tgz. Installed tarball under isolated /tmp prefix: --version=0.2.1, setup cursor migrated the old standard sessionEnd in place, and handoff --check --hook --hook-json cursor returned {}. Real user configuration untouched. Review and tagged release still pending.
- 2026-10-09T02:39:30Z claude-code@Seans-MacBook-Pro.local note: Built and launched native darwin-arm64 binary from release/v0.2.1: --version=0.2.1 and cursor handoff help exits 0. npm registry, GitHub Release and remote tag have no v0.2.1 yet; origin/main is 45c26a9, a fast-forward base for b0a7fbb. Awaiting independent read-only review before main/tag push.
- 2026-10-09T02:39:45Z claude-code@Seans-MacBook-Pro.local check ac=1: Set package, runtime, lockfile and generated plugin versions to 0.2.1; document 
- 2026-10-09T02:39:45Z claude-code@Seans-MacBook-Pro.local check ac=2: Build and test the versioned npm package and binary, then pass all three local g
- 2026-10-09T02:47:57Z claude-code@Seans-MacBook-Pro.local note: Reviewed release preparation b0a7fbb: independent read-only Go, no actionable findings. Native darwin-arm64 binary launched as 0.2.1. Fast-forwarded main to 1803567 and pushed it; remote Harness run 37875658883 and Install run 37875658845 both succeeded (same SHA). Tag push attempt was rejected by Claude Code automatic approval review because it triggers a public npm release and the classifier did not recognize direct release confirmation; no local or remote v0.2.1 tag was created. Publication and public-install criteria remain unchecked.
