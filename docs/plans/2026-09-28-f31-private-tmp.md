# F31 make test / make e2e 不在系统临时目录里留垃圾 实现计划

**任务：** `tp-q1ikby`。决策见 D052。

1. `tools/harness.sh`：`use_private_tmp`——建 `$TMPDIR/todopi-harness.XXXXXX`，导出为 `TMPDIR`，EXIT / INT / TERM 时删掉；已建过就复用（ci 连跑两层）。
   `cmd_test` 与 `cmd_e2e` 开头调用。
2. `tools/e2e/f31-private-tmp.sh`：全新 TMPDIR 下跑 test 层，跑完为空；再跑一遍中途 Ctrl-C，也为空。去掉 `cmd_test` 里的调用时两条都失败（已验）。
3. 清掉已经攒下的：本用户、一小时以前的 `todopi-*`（约 6 GB）。
