---
id: "tp-ujjc6y"
title: "brew：formula 与发布时更新它的步骤"
status: "open"
rank: "iw"
verify: "make check && make test"
labels: ["m4"]
created: "2026-09-27T03:14:04Z"
updated: "2026-09-27T12:58:02Z"
---

## Description

首发清单 §13：brew tap 上线。本任务写 formula（装单文件二进制、校验 SHA-256）与 release 工作流里更新它的步骤；tap 仓库由维护者建。

## Acceptance Criteria

- [x] Formula 按平台取 release 资产并校验 SHA-256
- [x] release.yml 生成 formula（或给出手动更新步骤）
- [ ] 本地用 brew install --formula 装一次实测

## Log

- 2026-09-27T03:14:04Z seandong created
- 2026-09-27T12:43:59Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-27T12:58:02Z claude-code@Seans-MacBook-Pro.local note: Evidence for criteria 1–2: tools/brew/formula.mjs generates Formula/todopi.rb from a release's SHA256SUMS (macOS/Linux × arm64/x64, per-asset sha256; fails on a missing platform, bad version, or conflicting duplicate checksums); release.yml attaches it to the Release and, with HOMEBREW_TAP_TOKEN (injected only into that step), commits it to seandong/homebrew-tap after the Release. tests/brew-formula.test.ts incl. ruby -c. Codex 2 rounds -> Go. D054, docs/brew.md.
  Criterion 3 NOT met yet: a temporary local tap install on this Mac downloaded the bun-built binary and verified its sha256 (a wrong sha256 was refused), brew style passed, and the binary passed the formula's test steps — but Homebrew 7.0.6 refused the install itself because the Command Line Tools are outdated (updating needs sudo; left to the maintainer). Remaining: after updating CLT (or on another machine), install from a local tap or from the real tap once it exists, and run brew test.
- 2026-09-27T12:58:02Z claude-code@Seans-MacBook-Pro.local check ac=1: Formula 按平台取 release 资产并校验 SHA-256
- 2026-09-27T12:58:02Z claude-code@Seans-MacBook-Pro.local check ac=2: release.yml 生成 formula（或给出手动更新步骤）
- 2026-09-27T12:58:02Z claude-code@Seans-MacBook-Pro.local released
