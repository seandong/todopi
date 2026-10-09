---
id: "tp-zapxfh"
title: "Release v0.2.1 with Cursor hook and installer fixes"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j0i"
verify: "make check && make test && make e2e"
created: "2026-10-09T02:25:59Z"
updated: "2026-10-09T02:35:40Z"
---

## Description

Publish the already merged Cursor sessionEnd JSON fix and removed-working-directory installer fix as a patch release. Synchronize version, plugin manifests and user documentation; verify on main and release artifacts. Cursor IDE interactive validation remains a separate open task.

## Acceptance Criteria

- [ ] Set package, runtime, lockfile and generated plugin versions to 0.2.1; document the shipped fixes without claiming Cursor IDE validation
- [ ] Build and test the versioned npm package and binary, then pass all three local gates and independent review
- [ ] Push tested main and v0.2.1 tag; Release workflow publishes npm and GitHub assets with matching checksums
- [ ] Install the published version in an isolated environment and verify Cursor sessionEnd and installer behavior without changing personal configuration

## Log

- 2026-10-09T02:25:59Z claude-code@Seans-MacBook-Pro.local created
- 2026-10-09T02:26:08Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-10-09T02:35:40Z claude-code@Seans-MacBook-Pro.local note: Prepared 0.2.1 package/runtime/lock and generated six plugin manifests, updated changelog and current docs. make check/test/e2e passed; npm pack produced todopi-0.2.1.tgz. Installed tarball under isolated /tmp prefix: --version=0.2.1, setup cursor migrated the old standard sessionEnd in place, and handoff --check --hook --hook-json cursor returned {}. Real user configuration untouched. Review and tagged release still pending.
