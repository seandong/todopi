# DECISIONS

架构与工程决策日志。记录**为什么**，不记录做了什么——做了什么在 git history 里。

新决策追加到文件末尾，不修改历史条目。决策被推翻时，新增一条引用旧条目编号并
说明推翻理由，旧条目保留。

格式：

```
## D<编号> — <标题>

- 日期：YYYY-MM-DD
- 状态：accepted | superseded by D<n> | reverted
- 背景：促使这个决策的约束或问题
- 决策：选了什么
- 理由：为什么不是其他选项
- 影响：谁会因此受限
```

---

## D001 — harness 工具用 Bash + Makefile，不用 TypeScript

- 日期：2026-09-15
- 状态：accepted
- 背景：todopi 的产品栈是 TypeScript + Bun，但仓库目前没有 `package.json`、
  没有 `src/`，README 明确声明 implementation has not started。harness 需要在
  这个「空仓库」状态下就能运行。
- 决策：`tools/harness.sh` 用 POSIX 风格 Bash 实现（兼容 macOS 自带的 bash 3.2），
  依赖仅 `git` / `make` / `jq`。不建 `package.json`。
- 理由：用 TypeScript 写 harness 会强制现在就建 `package.json`，等于提前 scaffold
  应用，与「implementation has not started」的事实冲突，也会让第一个真实 feature
  继承一堆不是它做的选择。Bash 的代价是可维护性，但 harness 脚本的复杂度上限
  很低，且随时可以在 CLI 可用后改写。
- 影响：脚本必须避开 bash 4+ 语法（`declare -A`、`mapfile`、`${var,,}`）。
  新增 harness 逻辑前先确认能在 bash 3.2 下跑。

## D002 — 前向状态先用 feature_list.json，规划迁移到 `.todopi/`

- 日期：2026-09-15
- 状态：accepted
- 背景：todopi 本身就是任务台账工具，自举（dogfood）在品牌与设计反馈上都有价值。
  但格式规格仍是 Draft，且没有 CLI 可用。
- 决策：当前用 `feature_list.json` + `PROGRESS.md`；迁移条件与字段映射写进
  [状态迁移契约](docs/harness/state-migration.md)，而不是留作口头计划。
- 理由：用未定稿的格式承载开发状态，会让 spec 的每次修订连带返工 harness；
  手写 `.todopi/tasks/*.md` 要人肉维护无环性和时间戳，正是产品要消灭的负担。
  把迁移条件写成契约，可以避免过渡形态变成永久形态。
- 影响：迁移必须在同一个 commit 内完成权威切换，不允许两套状态并存。

## D003 — feature_list 先建空表，不从 PRD 的 FR 机械翻译

- 日期：2026-09-15
- 状态：accepted
- 背景：PRD 有完整的 FR-A / FR-B / FR-D 编号，机械翻译可以立刻填满 feature_list。
- 决策：`features` 先留空数组，只固化结构与规则；第一批 feature 在 spec 定稿后
  单独 brainstorm。
- 理由：FR 是需求粒度，feature 是「一个 session 能做完且能被运行时证据验证的
  行为」粒度，两者不对齐。提前填满会造成大量长期 `not_started` 的噪音，
  并把「WIP=1」变成一种形式。
- 影响：harness 建成时 Scope 子系统是空的。这是已知状态，记录在 PROGRESS.md。

## D004 — 格式规格评审：11 项修正后推进到 Stable

- 日期：2026-09-15
- 状态：accepted
- 背景：`spec/todopi-format-v1.md` 标注 Draft for review，而 PROGRESS.md 的
  Next Steps #1 要求「格式定稿前不要开始实现」。一次逐条评审在规格与 PRD 中
  发现 11 个问题，其中 5 个是 MUST 条款级的自相矛盾——第三方照规格实现会直接卡住。
- 决策：逐条修正后把规格状态推进到 Stable，PRD 升到 1.1。格式版本仍是 `1`：
  所有修正都是**补全未定义行为或修正自相矛盾**，没有改变任何已定义键的语义，
  按规格 §9 不构成版本递增。
- 理由：逐条说明为什么是这个选择而不是别的——

  1. **rank 创建即分配**。原规格「有 rank 的排前、无 rank 的按 created 排后」
     叠加「move 不得改写他人 rank」，使 `move X --after Y`（Y 无 rank）无解；
     而 `add` 从不写 rank、`import` 全写 rank，混合种群是常态不是边界。
     另两个选项——放宽禁令、或砍掉 rank 与 move——前者让 diff 面不可预测，
     后者砍掉看板拖拽排序（决策 #20 已定）。
  2. **状态机补 reclaim**。§7.5 把 stale 的 in_progress 放进 ready 队列，
     但转换表没有 `in_progress → in_progress`。队列把任务摆出来、claim 又拒绝，
     两者自相矛盾；选择让 claim 与 ready 说同一套话，而不是要求 agent 理解
     「本机租约过期」与「跨机器 updated 超时」的区别才知道要不要加 flag。
  3. **reopen 清 assignee**。原转换只移除 `resolution`，产出 `open` + `assignee`，
     直接违反规格 §6.2 不变量 3。无第二种改法。
  4. **check 的 Log 带上标准文本**。原本只记 `ac=<n>`，而人在列表中间插入一条
     （§5.4 明确允许人工编辑）会让所有历史 `ac=n` 静默指向另一条标准，
     且 doctor 检测不出来——文件完全合法。对一个卖点是「done 需要证据」的产品，
     这是证据链本身不可靠。备选方案「给每条标准编 id」要人肉维护，
     且把验收区从标准 GitHub checkbox 变成私有格式。
  5. **通过的 verify 输出不进 Log**。Log 提交进 git 且被 `prime` 读取，
     2 KB ≈ 500 token 会吃掉 1500 预算的三分之一。通过时命令在 frontmatter、
     commit 在 Log，复现所需信息已齐；强制关闭保留 512 字节，因为那是人必须
     复查的唯一情形，证据要在 diff 里看得见。
  6. **被拒绝的转换完全不记 Log**。状态没变就不是任务历史上的事件；
     agent 一轮试五次就是五行永久噪音。值得留痕的教训走 `note`——
     由 agent 判断，而不是 CLI 无差别灌入。
  7. **拒绝时输出结构化报告（FR-D2a）**。原 PRD 只写 exit 2，输出内容完全未定义。
     但配合第 6 条，这份 stderr 是 agent 唯一能看到的东西，而协议要求它
     「去修活，别 force」；Ralph 循环的 back-pressure 也全靠它。
     不同时引入 `## Repair` 小节，是因为 scope.md 已指出 repair 是「最容易敷衍」
     的字段，且新增被识别小节按 §9 是加性变更，随时可加——等 dogfooding
     给出真实案例再定。
  8. **身份：写严格、读宽松（FR-C6）**。actor 取 agent 级而非 session 级，
     否则「下个会话是另一个 actor」，续做自己昨天的任务每次都要 steal，
     直接砸掉 G1。人在终端的 `ls --mine` / `handoff` 用宽松匹配
     （本机 `@host` 后缀）解决「人看不到自己 agent 的活」，
     不需要配置也不需要存 actor 清单。
  9. **prime 置顶协议提醒 + 逐项子预算**。原优先级把 6 行协议排在最后，
     它恰恰是压缩之后告诉 agent「怎么用 todopi」的东西；它是常量，
     置顶不参与裁剪的成本为零。子预算解决「单个条目撑爆预算导致拿不到 ready 队列」。
  10. **v0.1 看板降为只读**。brainstorm §4.1 I 自己写的目标是「给人看一眼
      agent 在干什么」，只读完全满足。四种写操作要求走与 CLI 相同的校验与锁路径，
      这会迫使 CLI 写路径在第一周就抽成可复用接口——一个很早的架构耦合。
      看板不承担分发价值（§11 判据：接入包和导入器才是分发本身），
      首发演示是终端录屏。砍集成家数是唯一伤及核心主张的砍法，不选。
  11. **软删除 `stale` 更名 `obsolete`**。与派生态 stale（租约过期）撞名，
      两者会在同一份列表里并排出现却表示毫不相干的事。现在改零成本——还没有用户。

  另外三处按唯一解修补，不单独论证：actor 规范化（`git config user.name`
  常含空格，而 actor 语法禁止空格，不规范化会让 Log 行解析错位）；
  `doctor --fix` 永不修改 Log；verify 的信任记录 MUST NOT 存在 `.todopi/` 内。

- 影响：规格状态变为 Stable，[状态迁移契约](docs/harness/state-migration.md)
  的触发条件 1 已满足（其余两条仍未满足）。`--as stale` 变为 `--as obsolete`。
  `verify` 的安全边界写入 PRD 非功能需求：把 `todopi` 加进 agent 命令白名单
  不是沙箱，`done` 执行的仓库内命令不经过 agent 的权限检查。

## D005 — 拆 feature 之前先确认技术方案与外部事实

- 日期：2026-09-15
- 状态：accepted
- 背景：D003 定的是「spec 定稿后拆 feature」。规格现已定稿（D004），
  但直接拆 feature 仍会踩两个坑。
- 决策：在写入 `feature_list.json` 之前插入两步——(1) 核实六家 agent 的外部事实；
  (2) 确认技术方案并调研可复用的三方组件。
- 理由：
  - PRD 的 FR-A2 逐条写死了六家的 hook / 事件名，这些是**外部 API**，
    写于 2026-09-14。不核实就拆，六个集成 feature 会建在过期假设上，
    而这类错误要到手工验证阶段（MVP 验收第 5 条）才暴露。
    同时要查的还有会话标识取法（FR-P1b 的回退逻辑依赖它）与各家沙箱
    是否约束子进程（README 安全段落的措辞依赖它）。
  - PRD 只定了「TypeScript + Bun 编译单二进制、npm 包跑 Node ≥ 20」，
    架构分层、模块边界、三方组件选型全未定。feature 的粒度是
    「一个 session 能做完且能被运行时证据验证的行为」，而这个粒度
    取决于架构长什么样——先拆后定架构，拆出来的表必然返工。
    YAML / frontmatter 解析、文件锁、CLI 参数解析、LexoRank、SSE
    都是有成熟实现的领域，自己写等于给一个「小代码量」的产品增加维护面。
- 影响：`feature_list.json` 继续保持空表。Scope 子系统的空态从
  「等 spec 定稿」变为「等技术方案确认」，两处文档（PROGRESS.md、scope.md）
  已同步。
