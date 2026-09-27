---
id: "tp-s4zovm"
title: "格式规格站点的内容：规格、12 字段表、语料库，可以直接部署的静态页"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "iv"
verify: "make check && make test"
labels: ["m4"]
created: "2026-09-27T03:14:03Z"
updated: "2026-09-27T12:38:54Z"
---

## Description

首发清单 §13：格式规格发布在 todopi.com/spec。本任务只做内容与构建；域名与部署是维护者的动作。

## Acceptance Criteria

- [x] 从 spec/ 生成静态页（规格全文、字段表、语料库索引），不引入新的运行时依赖
- [x] 本地能预览；部署步骤写清楚

## Log

- 2026-09-27T03:14:03Z seandong created
- 2026-09-27T12:13:55Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-27T12:37:25Z claude-code@Seans-MacBook-Pro.local note: Evidence: tools/site/build.mjs (make site) renders spec/ into .site/spec/: the specification with anchors and contents, the §5.2 field table page, IMPLEMENTING, the corpus index and one page per fixture with byte-identical downloads. commonmark plus a built-in pipe-table converter; no new dependency. Pages have no scripts and load nothing from other hosts: raw HTML is shown as text, javascript:/data:/vbscript: targets removed, images become plain links, table cells always render inline. Relative links, works from file:// and under /spec. docs/site.md covers build, preview, deploy (maintainer). tests/site.test.ts (5) incl. a hostile spec via TODOPI_SITE_SPEC. Codex 4 rounds -> Go. D053.
- 2026-09-27T12:37:25Z claude-code@Seans-MacBook-Pro.local check ac=1: 从 spec/ 生成静态页（规格全文、字段表、语料库索引），不引入新的运行时依赖
- 2026-09-27T12:37:25Z claude-code@Seans-MacBook-Pro.local check ac=2: 本地能预览；部署步骤写清楚
- 2026-09-27T12:38:54Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=ea5f122 dirty=true
