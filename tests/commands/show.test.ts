import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { runRelease } from "../../src/commands/release.ts";
import { runShow } from "../../src/commands/show.ts";
import { renderShow, renderShowJson } from "../../src/output/render/show.ts";
import { EXIT, CliError } from "../../src/exit.ts";

const ME = "me@host";

type Entry = ReturnType<typeof runShow>["log"][number];
const verbOf = (e: Entry): string | undefined => ("verb" in e ? e.verb : undefined);
const textOf = (e: Entry): string | undefined => ("verb" in e ? e.text : undefined);

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-show-"));
  runInit({ directory: d, prefix: "tp" });
  return d;
}
const taskPath = (d: string, id: string) => join(d, ".todopi", "tasks", `${id}.md`);
const edit = (d: string, id: string, f: (s: string) => string) =>
  writeFileSync(taskPath(d, id), f(readFileSync(taskPath(d, id), "utf8")));

/** created + 3 × (claimed, released) = 7 条 */
function sevenLogs(d: string): string {
  const t = runAdd({ directory: d, title: "T", actor: ME });
  for (let i = 0; i < 3; i++) {
    runClaim({ directory: d, id: t.id, actor: ME });
    runRelease({ directory: d, id: t.id, actor: ME });
  }
  return t.id;
}

test("默认显示最近 5 条 Log，且是**最后** 5 条，并给出总数", () => {
  // 写成 slice(0, 5) 也会「显示 5 条」——判据必须是哪 5 条。
  const d = repo();
  const id = sevenLogs(d);
  const r = runShow({ directory: d, id });
  assert.equal(r.log_total, 7);
  assert.equal(r.log.length, 5);
  assert.deepEqual(r.log.map(verbOf), ["released", "claimed", "released", "claimed", "released"]);
  assert.notEqual(verbOf(r.log[0]!), "created", "显示的是开头 5 条，不是最近 5 条");
});

test("--full 显示全部 Log", () => {
  const d = repo();
  const id = sevenLogs(d);
  const r = runShow({ directory: d, id, full: true });
  assert.equal(r.log.length, 7);
  assert.equal(verbOf(r.log[0]!), "created");
});

test("验收标准带序号与勾选状态", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", acceptance: ["first", "second"], actor: ME });
  edit(d, t.id, (s) => s.replace("- [ ] second", "- [x] second"));
  const r = runShow({ directory: d, id: t.id });
  assert.deepEqual(r.acceptance, [
    { n: 1, text: "first", checked: false },
    { n: 2, text: "second", checked: true },
  ]);
});

test("Log 的续行并进那一条的 text（spec §5.3.3：readers join with \\n）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  edit(d, t.id, (s) => s.trimEnd() + "\n- 2026-09-24T00:00:00Z me@host note: first line\n  second line\n  third line\n");
  const r = runShow({ directory: d, id: t.id });
  assert.equal(r.log_total, 2, "续行被当成了新条目");
  assert.equal(textOf(r.log.at(-1)!), "first line\nsecond line\nthird line");
});

test("全部 frontmatter 都在，含 verify 与 external", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", verify: "make test", labels: ["a"], actor: ME });
  edit(d, t.id, (s) => s.replace(/^(created: )/m, 'external:\n  harness:\n    legacy_id: "F99"\n$1'));
  const r = runShow({ directory: d, id: t.id });
  assert.equal(r.verify, "make test");
  assert.deepEqual(r.external, { harness: { legacy_id: "F99" } });
  assert.deepEqual(r.labels, ["a"]);
});

test("Description 显示；未识别小节被忽略（spec §5.3：readers MUST ignore）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", description: "the why", actor: ME });
  edit(d, t.id, (s) => s.replace("## Log", "## Repair\n\nSECRET-REPAIR\n\n## Log"));
  const r = runShow({ directory: d, id: t.id });
  assert.equal(r.description, "the why");
  assert.ok(!JSON.stringify(r).includes("SECRET-REPAIR"));
  assert.ok(!renderShow(r).includes("SECRET-REPAIR"));
});

test("id 不存在：退出码 usage，措辞与 claim 一致", () => {
  const d = repo();
  assert.throws(() => runShow({ directory: d, id: "tp-nope00" }),
    (e: unknown) => e instanceof CliError && e.code === EXIT.usage && /No task tp-nope00 in this ledger/.test(e.message));
});

test("字段值非法的任务拒绝显示并指向 doctor；只是组合非法的照常显示", () => {
  const d = repo();
  const bad = runAdd({ directory: d, title: "T", actor: ME });
  edit(d, bad.id, (s) => s.replace(/^status: "open"$/m, 'status: "bogus"'));
  assert.throws(() => runShow({ directory: d, id: bad.id }),
    (e: unknown) => e instanceof CliError && e.code === EXIT.usage && /doctor/.test(e.message));

  // invariant-3：in_progress 却没有 assignee——ls 容忍，show 也容忍
  const odd = runAdd({ directory: d, title: "U", actor: ME });
  edit(d, odd.id, (s) => s.replace(/^status: "open"$/m, 'status: "in_progress"'));
  assert.equal(runShow({ directory: d, id: odd.id }).status, "in_progress");
});

test("--json 是单个对象，不是数组", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  const parsed: unknown = JSON.parse(renderShowJson(runShow({ directory: d, id: t.id })));
  assert.ok(!Array.isArray(parsed) && typeof parsed === "object" && parsed !== null);
  assert.equal((parsed as { id: string }).id, t.id);
});

test("文本输出：标题、序号化的标准、Log 截断提示", () => {
  const d = repo();
  const id = sevenLogs(d);
  const out = renderShow(runShow({ directory: d, id }));
  assert.match(out, new RegExp(`^${id}  T$`, "m"));
  assert.match(out, /Log \(last 5 of 7; --full for all\)/);
});

// ── --tree ───────────────────────────────────────────────────────────────

test("--tree：父链从根到直接父任务；子任务按 §7.4 排序，各带自己的进度", () => {
  const d = repo();
  const root = runAdd({ directory: d, title: "root", actor: ME });
  const mid = runAdd({ directory: d, title: "mid", parent: root.id, actor: ME });
  const leaf = runAdd({ directory: d, title: "leaf", parent: mid.id, actor: ME });
  const c1 = runAdd({ directory: d, title: "c1", parent: leaf.id, actor: ME });
  const c2 = runAdd({ directory: d, title: "c2", parent: leaf.id, actor: ME });
  runAdd({ directory: d, title: "grandchild", parent: c2.id, actor: ME });
  edit(d, c1.id, (s) => s.replace(/^status: "open"$/m, 'status: "closed"\nresolution: "done"'));

  const r = runShow({ directory: d, id: leaf.id, tree: true });
  assert.deepEqual(r.tree!.ancestors.map((a) => a.id), [root.id, mid.id], "应当根在前");
  assert.deepEqual(r.tree!.children.map((c) => c.id), [c1.id, c2.id]);
  assert.equal(r.tree!.children[0]!.resolution, "done");
  assert.deepEqual(r.tree!.children[1]!.child_progress, { closed: 0, total: 1 }, "子任务自己的进度");
  assert.deepEqual(r.child_progress, { closed: 1, total: 2 });
  assert.equal(r.tree!.cycle, false);
  assert.match(renderShow(r), /Children \(1\/2 closed\)/);
});

test("--tree：parent 指向不存在的 id 时标 missing，不崩", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "orphan", actor: ME });
  edit(d, t.id, (s) => s.replace(/^(rank: )/m, 'parent: "tp-zzzzzz"\n$1'));
  const r = runShow({ directory: d, id: t.id, tree: true });
  assert.deepEqual(r.tree!.ancestors, [{ id: "tp-zzzzzz", missing: true }]);
  assert.match(renderShow(r), /tp-zzzzzz  \(missing/);
});

test("--tree：parent 成环时停下并标 cycle，不死循环", () => {
  // 成环是 doctor 报的不变量违规；show 不能因此卡死。
  // 环检测一旦失效，这里是**同步死循环**：不会失败，只会挂住。make test 给每条
  // 用例 120 秒超时（tools/harness.sh），挂住因此会变成失败而不是永远等下去。
  const d = repo();
  const a = runAdd({ directory: d, title: "a", actor: ME });
  const b = runAdd({ directory: d, title: "b", parent: a.id, actor: ME });
  edit(d, a.id, (s) => s.replace(/^(rank: )/m, `parent: "${b.id}"\n$1`));
  const r = runShow({ directory: d, id: b.id, tree: true });
  assert.equal(r.tree!.cycle, true);
  assert.deepEqual(r.tree!.ancestors.map((x) => x.id), [a.id]);
  assert.match(renderShow(r), /loops back/);
});

test("不带 --tree 时没有 tree 字段", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  assert.equal(runShow({ directory: d, id: t.id }).tree, undefined);
});

test("--tree：子任务按 rank 排，不是按读盘顺序（读盘顺序是文件名序）", () => {
  // 故意让 rank 序与文件名序**相反**：不排序的实现必然给出错的顺序，而不是 50% 碰巧对。
  const d = repo();
  const p = runAdd({ directory: d, title: "p", actor: ME });
  const x = runAdd({ directory: d, title: "x", parent: p.id, actor: ME });
  const y = runAdd({ directory: d, title: "y", parent: p.id, actor: ME });
  const [first, second] = [x.id, y.id].sort();
  edit(d, first!, (s) => s.replace(/^rank: ".*"$/m, 'rank: "z0"'));
  edit(d, second!, (s) => s.replace(/^rank: ".*"$/m, 'rank: "a0"'));
  const r = runShow({ directory: d, id: p.id, tree: true });
  assert.deepEqual(r.tree!.children.map((c) => c.id), [second, first]);
});

// ── 写回时保留未识别的内容（spec §5.3：MUST be preserved by writers）────────

test("claim / release / done 写回之后，未识别小节与首个标题前的段落原样保留", async () => {
  const { runDone } = await import("../../src/commands/done.ts");
  const d = repo();
  const t = runAdd({ directory: d, title: "T", description: "why", actor: ME });
  const preamble = "A paragraph before any heading.\n\n";
  const notes = "## Notes\n\n- keep me\n  exactly *as is*\n\n";
  const trailer = "\n## Repair\n\nstatic: fix the thing\n";
  edit(d, t.id, (s) => {
    const [, fm, body] = s.split(/^---$/m);
    return `---${fm}---\n${preamble}${body!.replace(/^\n/, "").replace("## Log", `${notes}## Log`).trimEnd()}\n${trailer}`;
  });

  runClaim({ directory: d, id: t.id, actor: ME });
  runRelease({ directory: d, id: t.id, actor: ME });
  runClaim({ directory: d, id: t.id, actor: ME });
  runDone({ directory: d, id: t.id, actor: ME });

  const after = readFileSync(taskPath(d, t.id), "utf8");
  assert.ok(after.includes(preamble), "首个标题前的段落丢了或变了");
  assert.ok(after.includes(notes), "## Notes 丢了或变了");
  assert.ok(after.includes(trailer.trim()), "Log 之后的 ## Repair 丢了或变了");
  // 新的 Log 行落在 ## Log 里，而不是跑到 ## Repair 下面
  const logEnd = after.indexOf("## Repair");
  assert.ok(after.lastIndexOf(" done ") < logEnd, "done 那一行写到了 ## Repair 下面");
  // 读的一侧照旧忽略它们
  const r = runShow({ directory: d, id: t.id, full: true });
  assert.ok(!JSON.stringify(r).includes("keep me"));
  assert.equal(r.log_total, 5);
});

test("Acceptance Criteria 里的非勾选行也显示 —— 自举任务的判据全是散文", () => {
  // spec §5.3.2：非复选框行不是标准，MUST 原样保留。它们仍在一个**已识别**的小节里，
  // 显示不碰文件。本仓库自举时把判据写成了散文，不显示它们，`show` 就看不见 AGENTS.md
  // 要求 done 之前人工核对的那段话（在真实账本上 dogfood 才发现）。
  const d = repo();
  const t = runAdd({ directory: d, title: "T", acceptance: ["a box"], actor: ME });
  edit(d, t.id, (s) => s.replace("- [ ] a box", "Prose judgement: it must do X.\n\n- [ ] a box\n  - nested note"));
  const r = runShow({ directory: d, id: t.id });
  assert.deepEqual(r.acceptance.map((c) => c.text), ["a box"], "散文不该变成编号标准");
  assert.deepEqual(r.acceptance_notes, [
    { after: 0, text: "Prose judgement: it must do X." },
    { after: 1, text: "  - nested note" },
  ]);
  assert.match(renderShow(r), /Prose judgement: it must do X\./);
});

test("散文与标准交错时按原文顺序显示 —— 说明不能跑到别的标准底下", () => {
  // 第一版把所有非勾选行抽出来统一放在编号项之后：第一条的说明被挪到第二条后面，
  // 人工核对时会误读归属（评审在临时账本实测）。那版用例只查「内容出现」，没查顺序。
  const d = repo();
  const t = runAdd({ directory: d, title: "T", acceptance: ["one", "two"], actor: ME });
  edit(d, t.id, (s) => s.replace("- [ ] one\n", "- [ ] one\n  - NOTE-FOR-ONE\n"));
  const out = renderShow(runShow({ directory: d, id: t.id }));
  const one = out.indexOf("1. [ ] one"), note = out.indexOf("NOTE-FOR-ONE"), two = out.indexOf("2. [ ] two");
  assert.ok(one >= 0 && note >= 0 && two >= 0, out);
  assert.ok(one < note && note < two, `说明必须夹在第 1 条与第 2 条之间：\n${out}`);
});

test("没有非勾选内容时不出 acceptance_notes", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", acceptance: ["x"], actor: ME });
  assert.equal(runShow({ directory: d, id: t.id }).acceptance_notes, undefined);
});

test("Description 只剥首尾空行，不吃掉代码块的缩进", () => {
  // 第一版对整段 .trim()，Markdown 缩进代码块首行的四格缩进会被吃掉（评审指出）。
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  edit(d, t.id, (s) => s.replace("## Log", "## Description\n\n    indented code\n    more\n\n## Log"));
  assert.equal(runShow({ directory: d, id: t.id }).description, "    indented code\n    more");
});

test("没有 : <text> 的头行挂着续行 —— 不能被显示成带正文的合法事件", async () => {
  // spec §5.3.3：续行是 <text> 的延续。`created` 后面没有 `: text`，那一行续行就无所
  // 归属；第一版把它显示成了一条带正文的 created（评审构造的伪造正文）。判定放在
  // doctor 的 Log 语法检查里，show 与 ls 通过同一份容忍名单自动跟随。
  const { runDoctor } = await import("../../src/commands/doctor.ts");
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  edit(d, t.id, (s) => s.trimEnd() + "\n  forged text\n");
  assert.throws(() => runShow({ directory: d, id: t.id }),
    (e: unknown) => e instanceof CliError && /doctor/.test(e.message));
  const report = runDoctor({ directory: d });
  assert.equal(report.ok, false);
  assert.match(JSON.stringify(report), /continuation/);
});
