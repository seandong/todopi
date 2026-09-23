// tools/check-ledger-policy.mjs
// 本仓库对自己账本的三条策略。ARCH-023 调用它。
//
// **用仓库自己的解析器，不用 grep。** 规格允许手写无引号的 `status: in_progress`，
// 按字符形状去数漏得掉（评审实测）。这个 session 已经在 `.skip` 上栽过三次：
// 别用字符形状近似一个需要真解析的判断。
//
// 三条都是 harness 的策略，不是 todopi 的功能——todopi 没有 WIP 概念，
// `claim` 也不拦被阻塞的任务（spec §6.1 的迁移表里没有这道门）。

import { discoverLedger } from "../src/format/discover.ts";
import { readTasks } from "../src/format/read.ts";

const ROOT = process.argv[2] ?? process.cwd();
const problems = [];
const tasks = [];

// **账本不在，本身就是违规。**
//
// 这条规则原先挂在 `applies_when: test -d .todopi/tasks` 上——目录没了就记
// not_applicable，而 `readTasks` 对读不到的目录返回空列表，于是三条策略全部
// 「通过」（评审实测）。本仓库已经自举，账本消失或读不动**永远**是故障，
// 不是「这条规则不适用」。
let entries;
try {
  entries = readTasks(discoverLedger(ROOT));
} catch (err) {
  console.log(`账本读不到：${err instanceof Error ? err.message : String(err)}`);
  process.exit(0);
}
if (entries.length === 0) {
  console.log(".todopi/tasks/ 里一个任务都没有。本仓库已自举，这不该发生");
  process.exit(0);
}

for (const t of entries) {
  // 解析失败要吵。读不动的文件会被读成空字段，然后从下面每一条计数里消失——
  // 那是最坏的一种假绿：检查「通过」了，而它根本没看见那个文件。
  if (t.parseError !== undefined) { problems.push(`${t.path}: 解析失败 —— ${t.parseError}`); continue; }
  tasks.push(t);
}

const fm = (t) => t.frontmatter;
const byId = new Map(tasks.map((t) => [fm(t).id, t]));

// 1. WIP=1
const active = tasks.filter((t) => fm(t).status === "in_progress");
if (active.length > 1) {
  problems.push(`${active.length} 个任务同时 in_progress（WIP=1）：`
    + active.map((t) => fm(t).id).join(", "));
}

// 2. 开工中的任务，它的前置必须是 closed 且 resolution done
//
// **必须是 done 而不只是 closed**：旧 make activate 要求依赖 state: passing，
// 而 `close --resolution wontfix` 之后后继同样会解除阻塞（评审实测）。
// 只查「已关闭」就是又一次静默降级。
for (const t of active) {
  for (const dep of fm(t).blocked_by ?? []) {
    const d = byId.get(dep);
    if (d === undefined) { problems.push(`${fm(t).id} 的前置 ${dep} 不存在`); continue; }
    if (fm(d).status !== "closed" || fm(d).resolution !== "done") {
      problems.push(`${fm(t).id} 已开工，但前置 ${dep} 是 `
        + `${fm(d).status}${fm(d).resolution ? `/${fm(d).resolution}` : ""}，不是 closed/done`);
    }
  }
}

// 3. 每个任务都要有 verify
//
// 旧 verify-feature 对空 layers[] 明确拒绝；而 todopi add 的 --verify 可省略、
// 无 verify 也能 done（Log 记 verify=none）。确实无可验证时显式写 verify: "true"
// ——要求写出来，而不是默许省略。
for (const t of tasks) {
  const v = fm(t).verify;
  if (typeof v !== "string" || v.trim() === "") {
    problems.push(`${fm(t).id} 没有 verify。无可验证时显式写 verify: "true"`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.log(p);
  process.exit(0);   // 输出即违规；arch-rules 的 expect: empty 负责判定
}
