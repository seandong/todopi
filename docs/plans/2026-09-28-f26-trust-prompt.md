# F26 首次执行 verify 的当场确认 实现计划

**任务：** `tp-t0mlsi`。**Spec:** PRD FR-D4；v0.1 缺口审计。决策见 D047。

1. `exec/prompt.ts`：`canAsk()`（stdin 与 stderr 都是终端）、`askYesNo()`（问题写 stderr，同步从 stdin 读一行，只有 y / yes 为真）。
2. `commands/verify.ts`：`confirmTrustBeforeLock` —— 未信任、任务有 verify、没有 `--yes`、不在 CI、能问时问一次；同意则记信任，否则退出 2。
   锁里的 `ensureTrusted` 不变（没终端时的拒绝与提示）。
3. `commands/done.ts`：拿锁之前调用它；提问方式可注入（`ask`），单测不碰真终端。
4. 测试：`tests/commands/verify.test.ts` 三条（答 y、答 n、各种不问的情形）；`tools/e2e/f26-trust-prompt.sh` 经 `script(1)` 在伪终端里
   等提示出现再「敲」答案（macOS 与 util-linux 都验过），加上没有终端、`--yes`、`CI=true`。
