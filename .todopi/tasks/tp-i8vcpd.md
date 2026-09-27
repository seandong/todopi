---
id: "tp-i8vcpd"
title: "规格语料的说明（note / reason / reader_must）改成英文"
status: "open"
rank: "j00"
verify: "make check && make test"
labels: ["m4"]
created: "2026-09-27T12:18:46Z"
updated: "2026-09-27T12:18:47Z"
---

## Description

spec/fixtures/*/*.json 的 note 与 reason 是中文，而规格与语料面向实现者、English-first（PRD 本地化一行）；规格站点（F33）照原文显示。

## Acceptance Criteria

- [ ] spec/fixtures 下所有 .json 的说明文字是英文，意思不变
- [ ] check-fixtures 与站点测试照样通过

## Log

- 2026-09-27T12:18:46Z claude-code@Seans-MacBook-Pro.local created from=tp-s4zovm
- 2026-09-27T12:18:47Z claude-code@Seans-MacBook-Pro.local edited fields=verify
