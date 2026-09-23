// tools/bootstrap-verify.mjs
// 自举迁移的对账：把 .todopi/tasks/ 的内容逐条逐字段对回原始的 feature_list.json。
//
// **刻意不 import 迁移脚本的任何东西。** 期望值在这里独立算一遍——拿迁移脚本的
// 输出去对迁移脚本是空转，而「迁移函数兼任自己的唯一校验器」正是本项目栽过多次的
// 那个形状（评审第二轮指出）。
//
// 迁移完成后仍然可重跑：原始 JSON 已被删除，就从删掉它的那个 commit 取父提交。

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { discoverLedger } from "../src/format/discover.ts";
import { readTasks } from "../src/format/read.ts";
import { parseLogLine, logLines } from "../src/domain/validate.ts";

const ROOT = process.argv[2] ?? process.cwd();
// stdio 里把 stderr 丢掉：走父提交那条分支时 git 会先对 HEAD 报一句预期中的
// "does not exist"，那不是错误，不该出现在对账的输出里。
const git = (...a) =>
  execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** 原始 JSON：HEAD 上还有就读它；没有了就从删除它的 commit 取父提交。 */
function originalJson() {
  try {
    return JSON.parse(git("show", "HEAD:feature_list.json"));
  } catch {
    const sha = git("log", "--diff-filter=D", "--format=%H", "-1", "--", "feature_list.json").trim();
    if (sha === "") throw new Error("既不在 HEAD 上，也找不到删除 feature_list.json 的 commit");
    return JSON.parse(git("show", `${sha}^:feature_list.json`));
  }
}

const problems = [];
const bad = (m) => problems.push(m);

const src = originalJson();
// 用仓库自己的读取器。解析失败要吵——不能让坏文件被读成空字段后从计数里消失。
const tasks = [];
for (const t of readTasks(discoverLedger(ROOT))) {
  if (t.parseError !== undefined) { bad(`${t.path}: 解析失败 —— ${t.parseError}`); continue; }
  tasks.push({ file: t.path, fm: t.frontmatter, body: t.body });
}

// legacy_id → 任务
const byLegacy = new Map();
for (const t of tasks) {
  const legacy = t.fm.external?.harness?.legacy_id;
  if (legacy === undefined) { bad(`${t.file}: 没有 external.harness.legacy_id`); continue; }
  if (byLegacy.has(legacy)) bad(`legacy_id ${legacy} 出现了不止一次`);
  byLegacy.set(legacy, t);
}

// 1. 数量与 id 集合
if (tasks.length !== src.features.length) {
  bad(`任务数 ${tasks.length} ≠ 原 feature 数 ${src.features.length}`);
}
const origIds = new Set(src.features.map((f) => f.id));
for (const id of origIds) if (!byLegacy.has(id)) bad(`原 ${id} 没有对应任务`);
for (const id of byLegacy.keys()) if (!origIds.has(id)) bad(`任务带着原文里没有的 legacy_id ${id}`);

// 2. 期望的 verify —— 独立重算，不从迁移脚本拿
const LAYER_ORDER = ["static", "runtime", "system"];
function expectedVerify(f) {
  const m = new Map((f.layers ?? []).map((l) => [l.label, l.cmd.trim()]));
  return LAYER_ORDER.filter((l) => m.has(l))
    .map((l) => (m.get(l) === "node --test" ? "make test" : m.get(l)))
    .join(" && ");
}

// milestone 分组
const msOf = new Map();
for (const [name, m] of Object.entries(src.milestones ?? {})) {
  for (const fid of m.features) msOf.set(fid, name.toLowerCase());
}

const newIdOf = new Map([...byLegacy].map(([legacy, t]) => [legacy, t.fm.id]));

for (const f of src.features) {
  const t = byLegacy.get(f.id);
  if (t === undefined) continue;
  const w = (m) => bad(`${f.id} (${t.file}): ${m}`);

  // state → status/resolution
  if (f.state === "passing") {
    if (t.fm.status !== "closed") w(`state=passing 应为 status=closed，实际 ${t.fm.status}`);
    if (t.fm.resolution !== "done") w(`state=passing 应为 resolution=done，实际 ${t.fm.resolution}`);
  } else if (f.state === "not_started") {
    if (t.fm.status !== "open") w(`state=not_started 应为 status=open，实际 ${t.fm.status}`);
    if (t.fm.resolution !== undefined) w(`not_started 不该有 resolution`);
  } else w(`原 state=${f.state} 没有映射规则`);

  // behavior → title + 正文原文
  if (!f.behavior.startsWith(t.fm.title.replace(/\.\.\.$/, ""))) w("title 不是 behavior 的前缀");
  if (t.fm.title.length > 200) w(`title ${t.fm.title.length} 字符，超过 200`);
  if (!t.body.includes(f.behavior)) w("behavior 原文没有出现在正文里");

  // depends_on → blocked_by
  const expDeps = (f.depends_on ?? []).map((d) => newIdOf.get(d)).sort();
  const gotDeps = [...(t.fm.blocked_by ?? [])].sort();
  if (JSON.stringify(expDeps) !== JSON.stringify(gotDeps)) {
    w(`blocked_by 不符：期望 ${JSON.stringify(expDeps)}，实际 ${JSON.stringify(gotDeps)}`);
  }

  // layers[].cmd → verify
  const expV = expectedVerify(f);
  if (t.fm.verify !== expV) w(`verify 不符：\n    期望 ${expV}\n    实际 ${t.fm.verify}`);

  // verification / repair / evidence 原文
  if (!t.body.includes(f.verification)) w("verification 原文没有出现在正文里");
  for (const l of f.layers ?? []) {
    if (l.repair && !t.body.includes(l.repair)) w(`${l.label} 层的 repair 原文没有出现在正文里`);
  }
  if (f.state === "passing" && !t.body.includes(f.evidence)) w("evidence 原文没有出现在 Log 里");

  // labels
  const labels = t.fm.labels ?? [];
  if (!labels.includes("bootstrap")) w("缺 bootstrap 标签");
  const ms = msOf.get(f.id);
  if (ms && !labels.includes(ms)) w(`缺 milestone 标签 ${ms}`);

  // 时间戳
  if (t.fm.created !== t.fm.updated) w("created 与 updated 应同为迁移时刻");

  // Log 语法（§5.3.3）
  for (const line of logLines(t.body)) {
    if (!parseLogLine(line).ok) w(`Log 行解析不通过：${JSON.stringify(line)}`);
  }
}

// 3. 原数组顺序 → rank 的字典序
const ranked = src.features.map((f) => byLegacy.get(f.id)?.fm.rank).filter(Boolean);
for (let i = 1; i < ranked.length; i += 1) {
  if (!(ranked[i - 1] < ranked[i])) {
    bad(`rank 顺序与原数组不一致：第 ${i} 条 ${ranked[i - 1]} 不小于 ${ranked[i]}`);
  }
}

// 4. milestones[].done_when 进了 PROGRESS.md
const progress = readFileSync(join(ROOT, "PROGRESS.md"), "utf8");
for (const [name, m] of Object.entries(src.milestones ?? {})) {
  if (!progress.includes(m.done_when)) bad(`${name} 的 done_when 原文没有出现在 PROGRESS.md`);
}

if (problems.length > 0) {
  console.error(`对账失败，${problems.length} 处：\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`对账通过：${tasks.length} 条，字段逐项对得上原始 feature_list.json`);
