# F25 格式版本更高的账本 实现计划

**任务：** `tp-39589y`。**Spec:** spec §9（MUST 拒绝写入，SHOULD 仍能读取）、PRD FR-Q2（退出码 4）；v0.1 缺口审计。决策见 D046。

1. `format/discover.ts`：`readConfig` 不再因版本更高而抛错；新增 `isNewerVersion`、`assertWritable`（退出 4）、`newerVersionNote`；
   `assertSupportedVersionIfPresent`（init 用）改为显式判断。
2. 写入口：`withLedgerLock` 拿锁之前 `assertWritable`；`createTask` 改走 `withLedgerLock`（原先直接 `withLock`，绕过了闸门）；
   落盘处（`createTaskUnlocked`、`prepareUpdate().commit`、`writeNormalized`）再挡一次。`handoff` 开头就挡。
3. `format/session.ts`：`recordPrime` / `markCompacted` 在版本更高时不写。
4. `cli.ts` 的 preAction：找得到账本且版本更高、没有 `--quiet` 时，stderr 一句提示。
5. 测试：`tests/format/discover.test.ts`（读得出、写入口退出 4、会话状态不写）、`tests/format/newer-version.test.ts`（每个落盘入口）；
   `tools/e2e/f25-newer-version.sh`：六个读命令与 web 可用且提示，十五个写命令退出 4、`.todopi/` 与租约目录逐字节不变。
