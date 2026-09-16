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

## D006 — v0.1 技术方案：十条选型，附实测数据

- 日期：2026-09-16
- 状态：accepted
- 背景：D005 要求拆 feature 前先确认技术方案。PRD 只定了「TypeScript + Bun 编译
  单二进制、npm 包跑 Node ≥ 20」，架构分层、模块边界、三方组件全未定。
  feature 的粒度是「一个 session 能做完且能被运行时证据验证的行为」，
  而这个粒度取决于架构长什么样——先拆后定架构，拆出来的表必然返工。
- 决策与理由（本机 M 系列 mac，Node 22.22.0 / Bun 1.3.14 实测）：

  1. **单一 Node 基线**，源码 MUST NOT 使用 `Bun.*`，Bun 只作编译器。
     Bun 1.3 内置 `Bun.YAML`（比 `yaml` 包快 5 倍），Node 没有任何内置 YAML——
     这个诱惑正是要挡住的。两个发行物若用不同 YAML 引擎，同一个任务文件在
     边界情况上可能被解析出不同结果，而「格式是第三方可独立实现的公开契约」
     是这个产品的护城河。该类错误本地用 bun 跑永远不暴露，只有 npm 用户会踩，
     故提升为 ARCH-007。

  2. **写入端一律加双引号**（规格级修正，见下）+ **读取端手写快路径**，
     任何偏离规范形态的行整个文件回退给 `yaml` 包。
     实测 2000 任务：`yaml` 包 120 ms，手写快路径 16 ms（7.5 倍）。
     引号规则本身不是性能优化而是**正确性修正**：实测 `title: feat: add login`
     直接解析失败、`title: fix #42` 被静默截断成 `fix`、`rank: 007` 变成整数 7。
     而「任务粒度约等于一次提交」意味着标题按惯例带冒号——这是常态不是边界。
     加引号后 18 个对抗性输入 18/18 完美 round-trip；副作用是消除了隐式类型
     推断，使快路径与 `yaml` 的一致性成为**构造保证**而非测试结论。

  3. **load-the-world**：每个命令读入不可变快照，领域层是纯函数；
     **不做 `.cache/index.json`**。反向关系（children/blocks）按规格是推导的，
     意味着 `done` 的子任务门禁、`show --tree` 都需要全局视图；按需读取会让
     校验能力取决于「当前代码路径恰好读了多少文件」，而不是产品决策。
     不做索引的理由是第一性的：缓存要安全，需要「垄断写入」或「监听文件系统」
     二者之一，而这两扇门都被已定的产品决策关死了——规格明文允许人工编辑与
     第三方写入，AGENTS.md 明文禁止 daemon。剩下的只有每次 stat 全部文件
     （实测 6 ms），而 stat 恰恰在最需要缓存的慢文件系统上最贵。
     失败形态更关键：缓存过期时 CLI 不报错，而是自信地给出过期的 ready 队列，
     agent 领走别人正在做的任务——正是 MVP 验收第 1 条要排除的「重复工作」。
     扩容路径是**归档已关闭任务**（增长几乎全来自永不删除的 closed 任务，
     而热路径不看它们），触发条件：单仓库 open 任务 > 5000，或全量扫描在目标
     平台上 > 500 ms。

  4. **独立输出 DTO**，人类可读输出与 `--json` 同源（单一结果对象 → 两个渲染器）。
     `--json` 按 FR-Q3 是有版本承诺的公开 API；直接序列化领域对象会让内部
     重命名变成对外破坏性变更，且没有任何测试会因此变红。提升为 ARCH-008。

  5. **自己写文件锁**（约 60 行），不用 `proper-lockfile`。
     后者核心是 mtime 心跳，靠 `setInterval` 实现，撞 ARCH-002 与「无常驻进程」
     原则；剥掉心跳后剩下的就是 `O_EXCL` + 退避 + 陈旧判定。而我们有它没有的
     信息源：锁按规格 §8 是**机器本地**的，可用 `kill(pid,0)` 精确判活而不是靠
     mtime 猜。锁文件记 `{pid, host, at}`——没有 host 就无法判断该 pid 是否本机，
     容器/挂载卷共享目录下会误判。实测 20 进程并发抢锁做读-改-写：零交错零丢失。
     **代价：并发压力测试 MUST 进 CI 且不得 flaky**，这是本条的真实成本。

  6. **`fractional-indexing`**（4.0.0，零传递依赖）配 base36 字符集，
     renumber 兜底自写。与第 5 条的判据差异值得记下：不是「代码多少行」，
     而是**错误能否被测试稳定抓住**。锁的并发冲突能（压测可复现），
     fractional indexing 的边界（无空间可插、进位、字符集边界）不能——
     它表现为「某次拖拽之后顺序莫名其妙」，测试里想不到。
     `lexorank`（2022 停更）因带 bucket 与后台重平衡作业而排除，那是给中心化
     数据库设计的。

  7. **`commander`**（15.0.0，零传递依赖）。帮助文本就是 agent 的发现机制——
     协议文本只有 800 token，装不下 20 个子命令的用法，agent 猜不到时会跑
     `--help`。自动生成保证它与实际接受的参数永不漂移，手写必然漂移且没有
     测试能抓到，只会让 agent 用错。FR-Q4 的宽容动词：已知别名用 `.alias()`，
     未知子命令的相近度建议要自写（默认建议不知道 `finish` 该指向 `done`）。

  8. **board 零构建**：单页 HTML 内联 CSS/JS，`fs.watch` 为主、轮询退化为辅
     （WSL2 与容器挂载卷在目标环境里，`fs.watch` 在那里不可靠；实测 stat 2000
     文件 6 ms，1 秒一次完全可接受）。端口占用报错退出而非自动换端口——
     自动换会让 `--open` 打开的不是你以为的那个。只读把难度降了一个量级：
     框架的价值在状态管理，而只读界面几乎没有状态。

  9. **`node:test`** 作测试运行器（第 1 条的推论：不引入 `bun test` 这个 Bun
     专属依赖，否则 CI 与本地会分叉）。**`spec/fixtures/` 语料库 +
     `spec/IMPLEMENTING.md`**：规格是 normative，语料库是它的可执行形式，
     说明书是 advisory 且 MUST NOT 引入新要求。做语料库的理由是实测得出的——
     那 18 个对抗性 case 在规格文字里一条都没有，因为写规格的人想不到自己
     没想到的东西。语料库同时是 todopi 自己的回归网（第 2 条的差分测试用它）。
     不做可执行验证器：第三方用 Go/Rust/Python，要的是测试数据而非一个必须先装
     todopi 才能跑的程序。打包成 skill 推迟到出现第一个第三方实现请求时——
     首发已要上六个市场，再上一个同名不同用途的 skill 会在获客最前端制造困惑。

  10. **npm + 智能安装脚本 + brew**，依赖不 bundle。
      实测体积：npm 包 228 KB，二进制 61 MB（macOS arm64）/ 66 MB（x64）/
      90 MB（Linux x64）；`--minify` 与 `--bytecode` 均无效，体积全部来自内嵌
      运行时。90 MB 对一个主打「12 个字段、无数据库」的产品是 off-brand 的。
      但二进制不能砍：`npm i -g` 的全局命令绑在当前 Node 版本上，nvm 切版本后
      `todopi` 会消失——而它是被 agent 在钩子里自动调用的，静默消失是很坏的
      失败形态。故 curl 安装器先探测 Node ≥ 20，有则装 npm 包（228 KB，秒装），
      无则下二进制。安装脚本是用户第一次接触产品的地方，MUST 有 CI 测试
      （有 Node / 无 Node 两种容器各跑一次）。
      不 bundle 依赖：三个包（`yaml`、`commander`、`fractional-indexing`）全部
      零传递依赖，`npm i` 装 4 个包本已足够干净；而这个工具会执行用户仓库里的
      shell 命令，安全姿态应是最大透明，不该把依赖藏进单文件换一个
      「0 dependencies」的徽章。

- 影响：格式规格因第 2 条新增写入端引号规则并改写 §10 示例——这是 v1 内的
  澄清（补全未定义行为），不递增格式版本。新增 ARCH-007/008/009 三条架构规则。
  `spec/fixtures/`（14 valid + 9 invalid）与 `spec/IMPLEMENTING.md` 建立，
  三份文档的权威顺序写入规格正文。

## D007 — PRD 只保留中文单本

- 日期：2026-09-16
- 状态：accepted
- 背景：PRD 此前维护中英两份，由 harness 的 `prd-sync` 与 ARCH-005 强制同 commit
  同步。双份的维护成本落在每一次 PRD 改动上，而 1.1 版那次评审两边各改 56 行。
- 决策：删除 `todopi-prd.md`（英文），把中文版改名占用该路径。取消 `prd-sync`
  检查（改为 `prd-present`），ARCH-005 改为只校验存在性。
- 理由：brainstorm 决策 #8 的原文是「英文为主（**CLI 输出、SKILL、README、官网**），
  中文文档补充；**仓库内设计文档可用中文**」。PRD 属于后者——它不是用户可见文案，
  是给自己和 agent 看的设计文档，与 brainstorm、DECISIONS、harness 文档同类。
  此前把 English-first 施加到 PRD 上，是把「分发语言」的规则错用到了「思考语言」上。
  保留双份的真实代价不是翻译工作量，而是**两份都会慢慢失真**：改动时总有一份先写，
  另一份是追平的，追平的那份措辞会逐渐脱离原意。
- 影响：AGENTS.md 的 English-first 边界改写为只约束用户可见文案
  （CLI 输出、README、`spec/`、协议文本、官网）。`spec/` 仍然是英文且 normative——
  第三方据它实现，这条不变。中文站点页面的计划不受影响。
