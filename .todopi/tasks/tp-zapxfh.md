---
id: "tp-zapxfh"
title: "Release v0.2.1 with Cursor hook and installer fixes"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j0i"
verify: "make check && make test && make e2e"
created: "2026-10-09T02:25:59Z"
updated: "2026-10-09T03:53:10Z"
---

## Description

Publish the already merged Cursor sessionEnd JSON fix and removed-working-directory installer fix as a patch release. Synchronize version, plugin manifests and user documentation; verify on main and release artifacts. Cursor IDE interactive validation remains a separate open task.

## Acceptance Criteria

- [x] Set package, runtime, lockfile and generated plugin versions to 0.2.1; document the shipped fixes without claiming Cursor IDE validation
- [x] Build and test the versioned npm package and binary, then pass all three local gates and independent review
- [x] Push tested main and v0.2.1 tag; Release workflow publishes npm and GitHub assets with matching checksums
- [x] Install the published version in an isolated environment and verify Cursor sessionEnd and installer behavior without changing personal configuration

## Log

- 2026-10-09T02:25:59Z claude-code@Seans-MacBook-Pro.local created
- 2026-10-09T02:26:08Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-10-09T02:35:40Z claude-code@Seans-MacBook-Pro.local note: Prepared 0.2.1 package/runtime/lock and generated six plugin manifests, updated changelog and current docs. make check/test/e2e passed; npm pack produced todopi-0.2.1.tgz. Installed tarball under isolated /tmp prefix: --version=0.2.1, setup cursor migrated the old standard sessionEnd in place, and handoff --check --hook --hook-json cursor returned {}. Real user configuration untouched. Review and tagged release still pending.
- 2026-10-09T02:39:30Z claude-code@Seans-MacBook-Pro.local note: Built and launched native darwin-arm64 binary from release/v0.2.1: --version=0.2.1 and cursor handoff help exits 0. npm registry, GitHub Release and remote tag have no v0.2.1 yet; origin/main is 45c26a9, a fast-forward base for b0a7fbb. Awaiting independent read-only review before main/tag push.
- 2026-10-09T02:39:45Z claude-code@Seans-MacBook-Pro.local check ac=1: Set package, runtime, lockfile and generated plugin versions to 0.2.1; document 
- 2026-10-09T02:39:45Z claude-code@Seans-MacBook-Pro.local check ac=2: Build and test the versioned npm package and binary, then pass all three local g
- 2026-10-09T02:47:57Z claude-code@Seans-MacBook-Pro.local note: Reviewed release preparation b0a7fbb: independent read-only Go, no actionable findings. Native darwin-arm64 binary launched as 0.2.1. Fast-forwarded main to 1803567 and pushed it; remote Harness run 37875658883 and Install run 37875658845 both succeeded (same SHA). Tag push attempt was rejected by Claude Code automatic approval review because it triggers a public npm release and the classifier did not recognize direct release confirmation; no local or remote v0.2.1 tag was created. Publication and public-install criteria remain unchecked.
- 2026-10-09T03:46:40Z claude-code@Seans-MacBook-Pro.local note: Published annotated v0.2.1 tag peeled to tested main 130881b. Release run 37880446442 succeeded: npm publish and GitHub Release with seven assets; Homebrew tap step skipped because token absent. npm registry now exposes todopi@0.2.1 as latest; dist.integrity sha512-0uRso/1cBSFE/Gozq1ye81N/NMktvlOMj73UF1SkUo7XDf25wGCzKpB1/1Fn15oTZ5EVViRWafMfoPvgsM9E8w== matches the Release tarball. Four binary archives pass SHA256SUMS. Tag Install 37880446471 passed; Harness 37880446440 still running. Public npm and GitHub binary install.sh paths in isolated HOME both return 0.2.1, upgrade the old standard Cursor sessionEnd hook in place, and return parseable {} for --hook-json cursor. Both install paths work from a deleted cwd. No personal agent configuration changed.
- 2026-10-09T03:48:50Z claude-code@Seans-MacBook-Pro.local note: Tag Harness run 37880446440 completed success, alongside Release 37880446442 and Install 37880446471. Public npm 0.2.1 is latest; Release tarball matches registry dist.integrity. Isolated public npm and binary installs, Cursor sessionEnd migration/JSON, and removed-cwd installation all passed. Cursor IDE real chat remains unverified under tp-zagvp5; Homebrew tap update was skipped because the token is absent.
- 2026-10-09T03:48:50Z claude-code@Seans-MacBook-Pro.local check ac=3: Push tested main and v0.2.1 tag; Release workflow publishes npm and GitHub asset
- 2026-10-09T03:48:50Z claude-code@Seans-MacBook-Pro.local check ac=4: Install the published version in an isolated environment and verify Cursor sessi
- 2026-10-09T03:53:10Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=29f63dd dirty=false
