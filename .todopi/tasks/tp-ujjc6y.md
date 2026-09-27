---
id: "tp-ujjc6y"
title: "brew：formula 与发布时更新它的步骤"
status: "open"
rank: "iw"
verify: "make check && make test"
labels: ["m4"]
created: "2026-09-27T03:14:04Z"
updated: "2026-09-27T03:14:04Z"
---

## Description

首发清单 §13：brew tap 上线。本任务写 formula（装单文件二进制、校验 SHA-256）与 release 工作流里更新它的步骤；tap 仓库由维护者建。

## Acceptance Criteria

- [ ] Formula 按平台取 release 资产并校验 SHA-256
- [ ] release.yml 生成 formula（或给出手动更新步骤）
- [ ] 本地用 brew install --formula 装一次实测

## Log

- 2026-09-27T03:14:04Z seandong created
