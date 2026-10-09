---
id: "tp-ocwx91"
title: "Fix Cursor sessionEnd hook JSON output"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j0h"
verify: "make check && make test && bash tools/e2e/f17-setup-cursor-gemini.sh"
created: "2026-10-08T23:56:02Z"
updated: "2026-10-09T00:30:38Z"
---

## Description

Cursor Agent CLI 2026.10.01-e373342 executes sessionEnd but marks todopi handoff --check --hook invalid_json because it prints a human report. Make generated and plugin Cursor hooks return valid JSON without changing human CLI output or other agents; verify in a real Cursor CLI session.

## Acceptance Criteria

- [x] Cursor sessionEnd prints valid JSON and generated plus plugin hooks use it
- [x] Existing human handoff and other agents keep their output contract
- [x] Real Cursor CLI sessionEnd hook reports success with the new command

## Log

- 2026-10-08T23:56:02Z claude-code@Seans-MacBook-Pro.local created from=tp-zagvp5
- 2026-10-08T23:56:14Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-10-08T23:56:52Z claude-code@Seans-MacBook-Pro.local edited fields=acceptance,description
- 2026-10-09T00:10:09Z claude-code@Seans-MacBook-Pro.local note: Real Cursor CLI sessionEnd on 2026.10.01-e373342 rejected original human text with errorClass=invalid_json; generated/plugin command now adds --hook-json cursor and handoff emits {} for this event. setup cursor upgrades the old standard sessionEnd entry in place. With temporary project hook pointing to branch CLI absolute path, Cursor debug log sessionEnd project status=success exitCode=0 (2026-10-09T00:08:58Z). Installed 0.2.0 on normal hook PATH still rejects new flag until this version is shipped; no personal configuration edited.
- 2026-10-09T00:10:54Z claude-code@Seans-MacBook-Pro.local check ac=1: Cursor sessionEnd prints valid JSON and generated plus plugin hooks use it
- 2026-10-09T00:10:54Z claude-code@Seans-MacBook-Pro.local check ac=2: Existing human handoff and other agents keep their output contract
- 2026-10-09T00:10:54Z claude-code@Seans-MacBook-Pro.local check ac=3: Real Cursor CLI sessionEnd hook reports success with the new command
- 2026-10-09T00:11:38Z claude-code@Seans-MacBook-Pro.local note: Additional migration case: a customized old sessionEnd hook is preserved and a new standard JSON hook is appended; setup warns that both can run. Focused unit suite 17/17 and f17 e2e passed. Full make check passed; final full make test/e2e pending completion.
- 2026-10-09T00:16:33Z claude-code@Seans-MacBook-Pro.local note: Independent review No-Go on two paths: invalid handoff --hook-json value wrote before rejecting, and setup cursor failed to warn when a standard and customized old sessionEnd coexisted. Added failing regression cases, moved validation before handoff, and warned after standard migration; focused tests 41/41 pass.
- 2026-10-09T00:30:38Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=1270b7a dirty=false
