---
id: "tp-kbfc4u"
title: "Detect missing cwd on Linux shells"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j0g"
verify: "make check"
created: "2026-10-08T14:43:41Z"
updated: "2026-10-08T15:07:05Z"
---

## Acceptance Criteria

- [x] The installer does not trust a shell cached pwd when the OS cwd is gone
- [x] Removed-cwd npm and binary regressions pass on Linux CI and macOS
- [x] Published raw and site installer continue to work without editing personal configuration

## Log

- 2026-10-08T14:43:41Z claude-code@Seans-MacBook-Pro.local created
- 2026-10-08T14:43:54Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-10-08T14:52:25Z claude-code@Seans-MacBook-Pro.local check ac=1: The installer does not trust a shell cached pwd when the OS cwd is gone
- 2026-10-08T14:52:25Z claude-code@Seans-MacBook-Pro.local check ac=3: Published raw and site installer continue to work without editing personal confi
- 2026-10-08T14:53:53Z claude-code@Seans-MacBook-Pro.local check ac=2: Removed-cwd npm and binary regressions pass on Linux CI and macOS
- 2026-10-08T14:54:03Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=d93b239 dirty=true
- 2026-10-08T14:56:56Z claude-code@Seans-MacBook-Pro.local reopened
- 2026-10-08T14:57:16Z claude-code@Seans-MacBook-Pro.local uncheck ac=2: Removed-cwd npm and binary regressions pass on Linux CI and macOS
- 2026-10-08T14:57:25Z claude-code@Seans-MacBook-Pro.local uncheck ac=3: Published raw and site installer continue to work without editing personal confi
- 2026-10-08T14:57:32Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-10-08T14:57:47Z claude-code@Seans-MacBook-Pro.local note: Previous done ran with dirty=true after AC2 was checked before the new Linux CI. Reopened and unticked AC2/AC3; close only after pushed main passes Harness/Install and the published site installer succeeds from a removed cwd.
- 2026-10-08T15:02:04Z claude-code@Seans-MacBook-Pro.local check ac=3: Published raw and site installer continue to work without editing personal confi
- 2026-10-08T15:06:55Z claude-code@Seans-MacBook-Pro.local check ac=2: Removed-cwd npm and binary regressions pass on Linux CI and macOS
- 2026-10-08T15:07:05Z claude-code@Seans-MacBook-Pro.local note: Linux Harness 37797035128 passed check/test/e2e; f21-install logged both removed-cwd npm and binary pass. Install 37797034995 passed artifacts/without-node/with-node. Published https://todopi.com/install.sh matched main and installed npm and checksum-verified binary from removed cwd into temporary directories on macOS (both 0.2.0); no personal config edited. Earlier pipeline shell-init/getcwd warning remains external to installer.
