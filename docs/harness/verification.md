# todopi 验证契约

本文件定义 harness 的验证行为：三层模型、状态词汇、降级规则和结果留存。
`tools/harness.sh` 是它的实现。

## 状态词汇

每一项检查只能报这四个词之一。混用这些词是 harness 最容易被绕过的地方。

| 状态 | 含义 | 什么时候用 |
|---|---|---|
| `pass` | 检查真的执行了，并且通过 | 只有实际跑过命令且退出码为 0 |
| `fail` | 检查真的执行了，没通过 | 有可读的失败输出 |
| `blocked` | 检查该跑，但前置条件缺失，跑不了 | 缺工具、缺凭据、缺设备、依赖层已 fail |
| `not_applicable` | 按当前改动范围，这一层不适用 | 例如仓库还没有 `src/` 时的类型检查 |

补充规则：

- `blocked` MUST NOT 被当作通过。任何 Gate 都不接受 `blocked`。
- `not_applicable` MUST 附带理由；无理由的 `not_applicable` 视为 `fail`。
- `not_run` 只出现在 CI 的 scope 摘要里，用于说明「CI 这个环境本来就不跑这层」。
  它不满足任何 Gate，也不能出现在本地 `make check` 的结果里。
- 轻量检查通过不代表 CLI 行为通过。文档层全绿 ≠ 产品能用。

## 三层模型

逐层阻断：**Layer N 出现 `fail` 时，do not proceed 到 Layer N+1**，
后续层记为 `blocked`。

### Layer 1 — 静态

`make check`。当前仓库无代码，这层主要是文档与规格的自洽：

| 检查 | 内容 | 无代码时 |
|---|---|---|
| `docs-links` | Markdown 内部相对链接指向的文件存在 | `pass` |
| `spec-version` | `spec/todopi-format-v1.md` 含 `version: 1` 声明且与 config 描述一致 | `pass` |
| `prd-present` | `todopi-prd.md` 存在（多条边界以它为 source）。PRD 自 2026-09-16 起只有中文单本，不再校验双语同步 | `pass` |
| `fixtures`（Layer 2） | `tools/check-fixtures.mjs`：`spec/fixtures/` 的每个 valid 样例扫描结果与 `.json` 期望值一致，每个 invalid 样例声明了它违反哪条规则，且 spec §6.2 的每条不变量都有对应 fixture | `pass` |
| `unit-test`（Layer 2） | `node --test`。运行器是 node:test 而非 bun test —— 见 DECISIONS D006 决策 1 | `not_applicable`（尚无 `tests/`） |
| `arch-rules` | `.harness/arch-rules.json` 全部规则 | 涉及源码的规则 `not_applicable` |
| `typecheck` | `tsc --noEmit` | `not_applicable`（无 `src/`） |

### Layer 2 — 运行时行为

`make test`。`bun test`。没有 `tests/` 目录时报 `not_applicable`，理由为
「尚无测试目录」。**MUST NOT 因为没有测试就报 `pass`。**

### Layer 3 — 系统确认

`make e2e`。CLI 端到端：在临时 git 仓库里 `init` → `add` → `claim` →
`done`（被失败的 verify 挡住）→ 修复 → `done` 成功。没有可执行 CLI 时报
`not_applicable`。

改动 cross-component 或跨领域边界时，Layer 3 是 required。

## 降级规则

harness 必须在「什么都还没有」的仓库里也能诚实运行。降级的唯一正确形式是
**报 `not_applicable` 并说明理由**，而不是跳过、静默或报 `pass`。

- 缺 `jq` → 依赖 `feature_list.json` 的命令报 `blocked`，给出安装命令。
- 缺 `bun` → Layer 2 / Layer 3 报 `blocked`，不是 `not_applicable`——
  测试本该跑，只是环境不具备。
- 无 `src/` / 无 `tests/` → 对应检查报 `not_applicable`。

区分 `blocked` 与 `not_applicable` 的判据：**这次改动本来需不需要这层？**
需要但跑不了是 `blocked`；本来就不需要才是 `not_applicable`。

## 结果留存

`make check` 与 `make ci` 把结构化结果写到 `.harness-results/check-<UTC>.json`：

```json
{
  "generated_at": "2026-09-15T00:00:00Z",
  "base_sha": "f767d79...",
  "overall": "pass",
  "layers": [
    {
      "layer": 1,
      "name": "static",
      "status": "pass",
      "checks": [
        { "name": "docs-links", "status": "pass", "summary": "..." }
      ]
    }
  ]
}
```

`.harness-results/` 被 `.gitignore` 忽略；CI 以 artifact 形式上传。
`overall` 的取值规则，按顺序判定：

1. 任一检查是 `fail` → `fail`
2. 无 `fail` 但有 `blocked` → `blocked`
3. 至少有一项真的执行并通过 → `pass`
4. 全部是 `not_applicable`（这一层一个检查都没执行）→ `not_applicable`

第 4 条是刻意的。一层里什么都没跑却报 `pass`，正是这个 harness 要防的假绿。
当前仓库无代码，Layer 2 与 Layer 3 的 overall 就是 `not_applicable`，不是 `pass`。

## Feature 级验证

`make verify-feature F=<id>` 是 feature 从 `active` 走到 `passing` 的唯一通道：

1. 读 `feature_list.json` 中该 feature 的 `layers[]`；
2. 按顺序执行每层的 `cmd`；任一层失败即停止，打印该层的 `repair` 文本；
3. 全部通过后，由 harness 写入 `state: passing` 和 `evidence`
   （commit SHA + UTC 时间戳）。

手工编辑 `state` 绕过这个流程，是本 harness 明确禁止的行为。
