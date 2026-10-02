---
id: "tp-hxa6yp"
title: "Emphasize diagnostic messages in terminal output"
status: "closed"
resolution: "done"
assignee: "claude-code@Mac"
rank: "j08"
verify: "make check && make test && make e2e"
created: "2026-10-02T02:08:45Z"
updated: "2026-10-02T02:24:18Z"
---

## Description

Cargo-style error and warning labels are colored, but their message text is visually weak in terminal output; keep task IDs cyan and non-terminal output plain.

## Acceptance Criteria

- [x] Error and warning messages are bold after the colored label in ANSI terminal output; embedded task IDs remain cyan.
- [x] Plain, mono, piped and agent output retain the expected text and escape safety.
- [x] The actual done gate is checked in a terminal pane, and check/test/e2e pass.

## Log

- 2026-10-02T02:08:45Z claude-code@Mac created
- 2026-10-02T02:08:51Z claude-code@Mac claimed
- 2026-10-02T02:18:20Z claude-code@Mac check ac=1: Error and warning messages are bold after the colored label in ANSI terminal out
- 2026-10-02T02:18:20Z claude-code@Mac check ac=2: Plain, mono, piped and agent output retain the expected text and escape safety.
- 2026-10-02T02:18:20Z claude-code@Mac check ac=3: The actual done gate is checked in a terminal pane, and check/test/e2e pass.
- 2026-10-02T02:24:18Z claude-code@Mac done verify=pass commit=03c679b dirty=false
