# F30 规格措辞：修复时保留 updated 的原文 实现计划

**任务：** `tp-qf0vch`。**Spec:** 规格 §5.1、§6.3、§9.1；D034。决策见 D051。

1. §5.1：引号规则后写明唯一例外（修复时的 `updated`）；「doctor --fix normalizes such files」补上「except for their `updated` entry」。
2. §6.3：修复清单里的时间戳形态限定为 `created` 的；新增一段——不改包括写法、逐字节保留、为什么、非规范的 updated 会怎样。
3. 实现检查清单那一条同步；§9.1 加 2026-09-28 修订记录。
4. 实测时发现 doctor 的 invariant-6 对非规范时间戳按字符串比会误报，修掉并加用例。
