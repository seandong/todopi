---
id: "tp-t843po"
title: "README 首发版：六家 agent 的安装说明、协议、vs Beads、读音；纠正与实现不符的声明"
status: "open"
rank: "ir"
verify: "make check && make test"
labels: ["m4"]
created: "2026-09-27T03:14:03Z"
updated: "2026-09-27T03:14:03Z"
---

## Description

首发清单 §13 要求 README 含六家安装方式、协议、「vs Beads」段落、读音与名字来源；审计另发现两处声明不准（验证失败就不能关成 done——--force 可以；依赖与体积）。

## Acceptance Criteria

- [ ] 六家各有一节：setup 命令、需要信任的地方（Codex 钩子、pi 项目）、todopi 必须在 PATH 上
- [ ] 协议文本或其链接
- [ ] vs Beads 段落
- [ ] 读音与名字来源（已有，核对）
- [ ] 每条声明都与实现一致

## Log

- 2026-09-27T03:14:03Z seandong created
