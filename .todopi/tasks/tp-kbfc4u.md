---
id: "tp-kbfc4u"
title: "Detect missing cwd on Linux shells"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j0g"
verify: "make check"
created: "2026-10-08T14:43:41Z"
updated: "2026-10-08T14:52:25Z"
---

## Acceptance Criteria

- [x] The installer does not trust a shell cached pwd when the OS cwd is gone
- [ ] Removed-cwd npm and binary regressions pass on Linux CI and macOS
- [x] Published raw and site installer continue to work without editing personal configuration

## Log

- 2026-10-08T14:43:41Z claude-code@Seans-MacBook-Pro.local created
- 2026-10-08T14:43:54Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-10-08T14:52:25Z claude-code@Seans-MacBook-Pro.local check ac=1: The installer does not trust a shell cached pwd when the OS cwd is gone
- 2026-10-08T14:52:25Z claude-code@Seans-MacBook-Pro.local check ac=3: Published raw and site installer continue to work without editing personal confi
