---
id: "tp-jyjtmp"
title: "todopi done 执行任务的 verify 命令，失败则拒绝关闭，超时终止整个进程组"
status: "closed"
resolution: "done"
blocked_by: ["tp-1lwice"]
rank: "i6"
verify: "make check && make test && bash tools/e2e/f07-verify.sh"
labels: ["bootstrap", "m1"]
external:
  harness:
    legacy_id: "F07"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-23T09:40:27Z"
---

## Description

todopi done 执行任务的 verify 命令，失败则拒绝关闭，超时终止整个进程组

迁移自 `feature_list.json` 的 **F07**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

verify 非零退出→拒绝、退出 2、不写 Log；通过→记 done verify=pass commit=<sha7> dirty=<bool> 且不记录输出（FR-D4a）；--force 关闭时记录输出尾部 512 字节；完整输出流式落 .todopi/.cache/verify/ 且不提交、不受尾部上限截断，捕获内存有界（含日志目标变慢时的背压）；超时用例：verify 派生孙进程，超时后**该进程组内**的孙进程 MUST 全部终止——实测运行时默认只杀直接子进程；主动 setsid 脱离该组的后代不在保证范围（FR-D2）；首次在某仓库执行 verify 要求确认并记入 ~/.config/todopi/trust，--yes 或 CI=true 跳过；每次执行前原样打印将要运行的命令。信任记录 MUST NOT 出现在 .todopi/ 内（spec §8）。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：孤儿进程用例失败→src/exec/run.ts 必须以独立进程组启动（detached）并在超时时向进程组发信号，而不是只 kill 直接子进程；内存/背压用例失败→src/exec/runner.ts 必须流式写日志并用 pipe 保留背压，不得把 chunk 攒在内存或流的缓冲里。verify 在 Windows 上明确不支持（FR-D2）。

- **system**：信任提示未出现→src/exec/trust.ts 的路径解析；输出写错地方→确认完整输出进 .cache/、只有 --force 时才进 Log。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F07
- 2026-09-23T09:40:27Z harness@migration done verify=pass commit=f672407: commit f672407, verified 2026-09-23T08:42:35Z
