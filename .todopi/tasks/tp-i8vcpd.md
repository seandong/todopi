---
id: "tp-i8vcpd"
title: "规格语料的说明（note / reason / reader_must）改成英文"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j00"
verify: "make check && make test"
labels: ["m4"]
created: "2026-09-27T12:18:46Z"
updated: "2026-09-27T14:04:07Z"
---

## Description

spec/fixtures/*/*.json 的 note 与 reason 是中文，而规格与语料面向实现者、English-first（PRD 本地化一行）；规格站点（F33）照原文显示。

## Acceptance Criteria

- [x] spec/fixtures 下所有 .json 的说明文字是英文，意思不变
- [x] check-fixtures 与站点测试照样通过

## Log

- 2026-09-27T12:18:46Z claude-code@Seans-MacBook-Pro.local created from=tp-s4zovm
- 2026-09-27T12:18:47Z claude-code@Seans-MacBook-Pro.local edited fields=verify
- 2026-09-27T13:51:02Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-27T14:02:46Z claude-code@Seans-MacBook-Pro.local note: Evidence: all 25 note/reason strings in spec/fixtures/*/*.json translated to English (only those values changed; every other byte identical). Review caught two carried-over problems, both fixed: the unquoted-hand-written note now says doctor --fix keeps the updated entry verbatim (§6.3, stale since F30), and conflict-markers says 'allows' instead of 'expects'. tests/spec-fixtures-english.test.ts keeps the explanation fields free of Chinese (fails on the old files). check-fixtures and site tests pass. Codex 2 rounds -> Go.
- 2026-09-27T14:02:46Z claude-code@Seans-MacBook-Pro.local check ac=1: spec/fixtures 下所有 .json 的说明文字是英文，意思不变
- 2026-09-27T14:02:46Z claude-code@Seans-MacBook-Pro.local check ac=2: check-fixtures 与站点测试照样通过
- 2026-09-27T14:04:07Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=c2e4ab5 dirty=true
