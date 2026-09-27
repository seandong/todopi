# F38 同一会话装了两份钩子时 prime 只注入一次 实现计划

**任务：** `tp-jlohuf`（从 `tp-lv7y3h` 派生）。决策见 D057。

1. `format/session.ts`：`claimHookInjection(ledger, session, nowMs, windowMs = 10_000)`——账本写锁里读写 `<session>.hooked`（上次注入的毫秒），窗口内返回 false。
2. `commands/hook.ts`：`firstInjection(directory, session)`——没有会话 id 返回 true；出错返回 true。`cli.ts` 的 `prime --hook` 有输出时先问它。
3. OpenCode 插件与 pi 扩展的模板：进程级标志 `globalThis.__todopiPrimeLoaded`，第二份不注册钩子。
4. 测试：`tests/format/hook-dedupe.test.ts`（窗口、别的会话、时钟回拨、无会话 id、版本更高）；`tests/commands/setup.test.ts`（两份插件 / 扩展只一份注册）；
   `tools/e2e/f38-hook-dedupe.sh`（五个并发钩子恰好一个注入；别的会话、无会话 id、手动 prime 照常）。
