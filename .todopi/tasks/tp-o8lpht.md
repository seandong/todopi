---
id: "tp-o8lpht"
title: "Install from a removed working directory"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j0f"
verify: "make check"
created: "2026-10-08T14:21:04Z"
updated: "2026-10-08T14:32:40Z"
---

## Acceptance Criteria

- [x] The installer runs its npm path from a valid directory when the invoking cwd has been removed
- [x] The standalone binary startup check succeeds from a valid directory when the invoking cwd has been removed
- [x] The removed-cwd regression and existing install scenarios pass without editing user configuration

## Log

- 2026-10-08T14:21:04Z claude-code@Seans-MacBook-Pro.local created
- 2026-10-08T14:21:15Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-10-08T14:31:37Z claude-code@Seans-MacBook-Pro.local check ac=1: The installer runs its npm path from a valid directory when the invoking cwd has
- 2026-10-08T14:31:37Z claude-code@Seans-MacBook-Pro.local check ac=2: The standalone binary startup check succeeds from a valid directory when the inv
- 2026-10-08T14:31:37Z claude-code@Seans-MacBook-Pro.local check ac=3: The removed-cwd regression and existing install scenarios pass without editing u
- 2026-10-08T14:32:40Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=337bb04 dirty=false
