// tools/ledger-summary.mjs
// `make status` 的账本摘要：三种状态的计数，以及**所有** in_progress 任务。
//
// **用仓库自己的解析器，不用 grep。** 第一版 status 面板用
// `grep -c '^status: "closed"$'` 数——漏掉规格允许的无引号写法，也没数
// in_progress（评审实测）。这个 session 里同一个错误犯了第三次：先是 `.skip`
// 的三版正则，再是账本策略检查器，然后是这里。**凡是要判断「这个字段是什么」，
// 就去问解析器。**
//
// 展示的是**所有** in_progress，不是 `ls --mine`：迁移前的 make status 会列出全部
// active feature，只看自己的会把别人认领的任务藏起来（评审指出，这是迁移损失表的
// 第十三条）。

import { discoverLedger } from "../src/format/discover.ts";
import { readTasks } from "../src/format/read.ts";

// **读不到就非零退出，不能报 0/0/0。**
//
// `readTasks` 对缺失或不可读的目录返回空数组——评审把 tasks/ 设成不可读后复现：
// 摘要报「0 open / 0 in_progress / 0 closed」并退出 0，于是 make status 把
// 「账本读不到」当成了成功。这和 ARCH-023 那个洞是同一个形状，同一批改动里第二次。
let tasks;
try {
  tasks = readTasks(discoverLedger(process.argv[2] ?? process.cwd()));
} catch (err) {
  process.stderr.write(`账本读不到：${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
if (tasks.length === 0) {
  process.stderr.write(".todopi/tasks/ 读不到任何任务。本仓库已自举，这不该发生\n");
  process.exit(1);
}

const bad = tasks.filter((t) => t.parseError !== undefined);
const ok = tasks.filter((t) => t.parseError === undefined);
const count = (st) => ok.filter((t) => t.frontmatter.status === st).length;

const other = ok.length - count("open") - count("in_progress") - count("closed");
process.stdout.write(
  `  计数            ${count("open")} open / ${count("in_progress")} in_progress / `
  + `${count("closed")} closed`
  + (other > 0 ? ` / ${other} 状态不认识` : "")
  + (bad.length > 0 ? ` / ${bad.length} 读不动` : "") + "\n",
);

for (const t of bad) process.stdout.write(`  ！读不动        ${t.path}：${t.parseError}\n`);

const active = ok.filter((t) => t.frontmatter.status === "in_progress");
if (active.length > 0) {
  process.stdout.write("\n  在做（全部 in_progress，不只是自己的）：\n");
  for (const t of active) {
    process.stdout.write(`    ${t.frontmatter.id}  [${t.frontmatter.assignee ?? "无 assignee"}]  `
      + `${t.frontmatter.title}\n`);
  }
}
