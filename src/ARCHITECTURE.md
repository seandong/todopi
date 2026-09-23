# src/ 架构

五层，依赖方向单向向下。上层可以 import 下层，反过来不行。`fs/` 与 `exec/` 并列在最底层。

| 层 | 职责 | 允许 import |
|---|---|---|
| `commands/` | 编排一条命令：读取 → 计算 → 组装报告 | 全部 |
| `output/` | DTO 与渲染。`dto/` 是对外契约的唯一定义处 | `domain/`（仅 `dto/`）、`format/` 的类型 |
| `domain/` | 派生态、校验、图算法。**纯函数，不 import `node:fs`** | 仅 `domain/` 内部 |
| `format/` | 磁盘 ↔ 内存。`.todopi/` 的解析、发射、发现、id 生成 | `node:*`、`yaml`、`fs/`、`domain/types.ts`（仅类型与常量） |
| `fs/` | 文件系统原语：原子替换、锁。**不认识 todopi 的格式** | 仅 `node:*` |
| `exec/` | 子进程与用户级配置：以独立进程组执行 `verify`、按仓库路径的信任记录。**不认识 todopi 的格式** | 仅 `node:*`，以及同目录的 `./<name>.ts` |

顶层还有一个文件不属于任何层：`protocol.ts`。它是写进用户仓库的协议文本，
有三个消费者（`init` 写 `AGENTS.md`、六家 `setup` 写各家规则文件、文档站），
不属于任何一条命令。PRD §9 明说它是产品产物、改它不是代码变更。

**`fs/` 与 `format/` 为什么分开。** `format/` 懂 todopi 的格式，`fs/` 只懂文件系统。
原子替换（临时文件 + fsync + rename）与文件锁（`O_EXCL` + pid 判活）对任何要写文件的
程序都一样，和 12 个字段没有关系。分开的实际收益在 F03：文件锁会建在 `fs/atomic.ts`
之上，而锁的并发压力测试不需要构造任何任务文件。
这一层由 ARCH-016 保证登记——每个 `src/` 下的目录都必须在上表里出现。

**`exec/` 为什么不并进 `fs/`。** 两者都在最底层、都不 import 任何上层，但管的是不同的
外部世界：`fs/` 是这台机器上的文件，`exec/` 是子进程与用户级配置（`~/.config/todopi/`）。
把它们混在一起，那条「`fs/` 只认识文件系统」的判断就没法再用来回答「这个函数该放哪」。
`exec/` 由 ARCH-021 约束，与 `fs/` 的 ARCH-019 是同一条规则的两个实例。

两条规则限的是**层**，不是文件——但**只有 ARCH-021 放行了同目录的 `./<name>.ts`**
（`runner.ts` 用 `tail.ts`），`../` 仍然抓得到。ARCH-019 没有跟着放：`fs/` 今天没有
同层拆分的需求，为一个不存在的情形拆栏杆就是把 guard 改松。哪天它真要拆，再改那一条，
那次改动会连同理由一起出现在 diff 里。（2026-09-23 评审收回，见 DECISIONS D027。）

`exec/` 里有两个进程：`run.ts` 同步调用，`runner.ts` 是它派出去的那个。分开的理由写在
`runner.ts` 的头部——`done` 在文件锁内串行执行所以调用必须同步，而「独立进程组」只有
Node 的异步 spawn 支持。

## 两条不可越过的线

**`domain/types.ts` 是共享词汇，不是依赖倒置。** `format/` 可以 import 它，
因为它只有类型与正则常量（`TaskFile` 的形状、spec §4 的 id 正则、§5.4 的 actor
正则），**没有任何行为**。一个两层都要说的名字放在哪都得有人跨线；让它待在
`domain/` 并允许 `format/` 引用类型，比复制一份定义或新开一个目录都便宜。
`format/` MUST NOT import `domain/` 的任何**函数**——校验、派生态、图算法一律
由调用方注入（见 `format/write.ts` 的 `Validate`）。

**`domain/` 不碰文件系统。** 不变量校验、派生态（ready/blocked/stale）、排序、图算法
全是纯函数，用例直接构造对象即可——不需要临时目录、不需要 git 仓库、不需要管时序。
这是整个测试策略的支点：最容易出错也最需要穷尽覆盖的逻辑，落在跑得最快的那一层。

**`output/render/` 不 import `domain/`。** 由 ARCH-008 机器执行。`--json` 是有版本
承诺的公开 API（FR-Q3：破坏性变更升 CLI 主版本）；直接序列化领域对象时，一次内部
重命名就是一次对外破坏性变更，而且不会有任何测试因此变红——用的是同一个对象。
`output/dto/` 是唯一允许跨这条线的地方，它只做字段搬运与改名，**不做计算**。
一旦开始在映射里算派生态或拼字符串，这一层就白分了。

## 读取路径为什么有两条

写入端一律给标量加双引号（spec §5.1），这让 frontmatter 成为一个规则很窄的子语言：
每个值要么是带引号的字符串，要么是带引号元素的 flow 列表。`format/scan.ts` 直接
扫描这个子语言，实测比通用 YAML 解析快 7.5 倍（2000 个任务：16ms vs 120ms）。

任何一行偏离这个形态——人手写的文件、第三方工具写的、后续版本写的——整个文件
交给 `yaml` 包。两条路径的一致性由 `tests/fixtures.test.ts` 的差分断言保证。

**不要为这条路径加缓存或索引**（ARCH-011）。读路径只有一条：全量扫描，读到的就是
磁盘真相。理由见 DECISIONS D006 决策 3。

## 语言与运行时约定

- **不写 `enum` / `namespace` / 装饰器**（ARCH-013）。Node 22 通过类型剥离直接执行
  `.ts`，而剥离只删类型、不做类型导向的代码生成——`enum` 会在运行时报 SyntaxError
  而 `tsc --noEmit` 却能通过，静态绿运行时红是最难查的一类。`tsconfig.json` 开了
  `erasableSyntaxOnly`，让类型检查阶段就拦下来。用 `as const` 数组加
  `typeof X[number]` 代替。
- **不用 `Bun.*`**（ARCH-007）。Bun 只在发布二进制时作为编译器出现。
- **ESM，没有 `require`**。`package.json` 的 `type` 是 `module`；取当前文件目录用
  `import.meta.dirname`。
- **import 路径写全 `.ts` 后缀**。Node 的 ESM 解析要求如此，`tsconfig.json` 的
  `allowImportingTsExtensions` 与之对应。
- **不直接调用 `process.exit()`**。抛 `CliError`，由 `src/cli.ts` 的顶层 catch
  统一映射到 `process.exitCode`——`process.exit()` 会截断尚未 flush 的 stdout。
