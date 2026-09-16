# src/ 架构

四层，依赖方向单向向下。上层可以 import 下层，反过来不行。

| 层 | 职责 | 允许 import |
|---|---|---|
| `commands/` | 编排一条命令：读取 → 计算 → 组装报告 | 全部 |
| `output/` | DTO 与渲染。`dto/` 是对外契约的唯一定义处 | `domain/`（仅 `dto/`）、`format/` 的类型 |
| `domain/` | 派生态、校验、图算法。**纯函数，不 import `node:fs`** | 仅 `domain/` 内部 |
| `format/` | 磁盘 ↔ 内存。解析、发射、发现、锁 | `node:*`、`yaml` |

## 两条不可越过的线

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
