# tp-rk6o8q 人在终端里看时输出带样式（先做 init 与 setup）—— 计划

来由：dogfood 反馈，`todopi init` 纯文本「真丑」。约束：进模型上下文的输出不能有转义（ARCH-027）。

1. `src/output/style.ts`：`Style`（bold / dim / green / yellow / cyan / red，外加成功标记）的两份实现 PLAIN 与 ANSI，手写 SGR，不加依赖；
   纯函数 `chooseStyle(facts)` 是唯一的判定：
   - `--json`、钩子路径（`--hook` / `--hook-json` / `--if-compacted` / `--mark-compacted`）→ 纯文本，FORCE_COLOR 也不越过
   - 有 agent 在场 → 纯文本：`--agent` / `TODOPI_AGENT` 给了，或环境里**任何一个** agent 信号在（与身份推断不同：嵌套时身份不猜，
     上色则更要保守）。有的 agent 在伪终端里跑命令，只看 isTTY 不够
   - `NO_COLOR`（有这个变量就算，空值也算）、`TERM=dumb` → 纯文本
   - `FORCE_COLOR`（非空、非 0）→ 上色：只越过 isTTY 的判断
   - 否则看 stdout.isTTY
2. `commands/actor.ts` 加 `agentPresent()`；cli.ts 一个 `styleFor()`，init / setup 的渲染器收 `style`（默认 PLAIN，已有测试逐字节不变）。
3. init 的内容也改：`Initialized todopi in <root>`、文件前的 + / ~ / = 标记、相对路径；Next 先 `todopi setup <agent>` 再 `add`；
   --quiet 只去掉 Next。setup 的纯文本版不变（e2e 依赖 `^unchanged`、`^created <path>`），上色版给状态词上色、家目录缩成 ~。
4. 测试：`chooseStyle` 真值表；子进程在 FORCE_COLOR 下 `--json`、`prime --hook`、`CLAUDECODE=1`、`TODOPI_AGENT`、`NO_COLOR` 的 stdout 无 ESC，
   只给 FORCE_COLOR 时有；变异：去掉 agent 分支要红。check-injected-output 在 FORCE_COLOR 下也跑一次。
5. 先给用户看 init / setup 的效果，再推到 ls / show / claim / done / doctor。
