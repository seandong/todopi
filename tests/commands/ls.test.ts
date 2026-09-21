import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { runLs, parseLimit } from "../../src/commands/ls.ts";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { renderText, renderJson, renderDiagnostics } from "../../src/output/render/ls.ts";
import { EXIT } from "../../src/exit.ts";

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-ls-"));
  runInit({ directory: d, prefix: "tp" });
  return d;
}
const ids = (r: { tasks: Array<{ id: string }> }): string[] => r.tasks.map((t) => t.id);

/** 直接改文件来造状态——claim / done 要到 F05/F06 才有。 */
function patch(dir: string, id: string, edit: (line: string) => string): void {
  const p = join(dir, ".todopi", "tasks", `${id}.md`);
  writeFileSync(p, readFileSync(p, "utf8").split("\n").map(edit).join("\n"));
}
function closeTask(dir: string, id: string): void {
  patch(dir, id, (l) => (l.startsWith("status:") ? 'status: "closed"\nresolution: "done"' : l));
}
function claimTask(dir: string, id: string, actor: string, updated?: string): void {
  patch(dir, id, (l) => {
    if (l.startsWith("status:")) return `status: "in_progress"\nassignee: ${JSON.stringify(actor)}`;
    if (updated !== undefined && l.startsWith("updated:")) return `updated: ${JSON.stringify(updated)}`;
    return l;
  });
}

test("默认只列未关闭的任务（FR-T2）", () => {
  const d = repo();
  const open = runAdd({ directory: d, title: "open one" });
  const done = runAdd({ directory: d, title: "done one" });
  closeTask(d, done.id);
  assert.deepEqual(ids(runLs({ directory: d })), [open.id]);
});

test("--closed 只列已关闭的；--all 两者都列", () => {
  const d = repo();
  runAdd({ directory: d, title: "open" });
  const done = runAdd({ directory: d, title: "done" });
  closeTask(d, done.id);
  assert.deepEqual(ids(runLs({ directory: d, closed: true })), [done.id]);
  assert.equal(runLs({ directory: d, all: true }).tasks.length, 2);
});

test("--ready 用 spec §7.5 的定义：容器与被阻塞的都不在其中", () => {
  const d = repo();
  const parent = runAdd({ directory: d, title: "container" });
  runAdd({ directory: d, title: "child", parent: parent.id });
  const blocker = runAdd({ directory: d, title: "blocker" });
  const blocked = runAdd({ directory: d, title: "blocked", blockedBy: [blocker.id] });
  const ready = ids(runLs({ directory: d, ready: true }));
  assert.ok(!ready.includes(parent.id), "容器不该在 ready 队列");
  assert.ok(!ready.includes(blocked.id), "被阻塞的不该在 ready 队列");
  assert.ok(ready.includes(blocker.id));
});

test("--blocked 列出被阻塞的", () => {
  const d = repo();
  const blocker = runAdd({ directory: d, title: "blocker" });
  const blocked = runAdd({ directory: d, title: "blocked", blockedBy: [blocker.id] });
  assert.deepEqual(ids(runLs({ directory: d, blocked: true })), [blocked.id]);
});

test("--label 过滤", () => {
  const d = repo();
  const auth = runAdd({ directory: d, title: "auth one", labels: ["auth"] });
  runAdd({ directory: d, title: "other", labels: ["web"] });
  assert.deepEqual(ids(runLs({ directory: d, label: "auth" })), [auth.id]);
});

test("--limit 截断，但先排序再截断；total 仍是过滤后的匹配数", () => {
  const d = repo();
  for (let i = 0; i < 5; i++) runAdd({ directory: d, title: `t${i}` });
  const all = ids(runLs({ directory: d }));
  const limited = runLs({ directory: d, limit: 2 });
  assert.deepEqual(ids(limited), all.slice(0, 2));
  assert.equal(limited.total, 5, "total 是匹配数而不是显示数，否则「显示 2 条共 5 条」没法写");
});

test("--limit 不是非负整数时报用法错误，而不是悄悄当成不限（FR-Q2 退出 1）", () => {
  // 对 agent 来说「悄悄列出全部」是最坏的结果：它以为自己限了量，
  // 于是把整个账本灌进上下文。
  const d = repo();
  for (const bad of [Number.NaN, -1, 1.5]) {
    assert.throws(() => runLs({ directory: d, limit: bad }),
      (e: unknown) => (e as { code: number }).code === EXIT.usage, `--limit ${bad} 应当报错`);
  }
  assert.equal(runLs({ directory: d, limit: 0 }).tasks.length, 0, "--limit 0 是合法的：什么都不显示");
});

test("互斥的模式选项一起给时报用法错误，而不是静默取其一", () => {
  const d = repo();
  assert.throws(() => runLs({ directory: d, ready: true, closed: true }),
    (e: unknown) => (e as { code: number }).code === EXIT.usage);
  assert.throws(() => runLs({ directory: d, all: true, blocked: true }),
    (e: unknown) => (e as { code: number }).code === EXIT.usage);
  // --mine 与 --label 不是模式，能和任何模式叠加
  assert.doesNotThrow(() => runLs({ directory: d, ready: true, mine: true, label: "x" }));
});

test("--mine 用宽松匹配（FR-C6）", () => {
  const d = repo();
  const mine = runAdd({ directory: d, title: "mine" });
  claimTask(d, mine.id, `claude-code@${hostname()}`);
  runAdd({ directory: d, title: "theirs" });
  assert.deepEqual(ids(runLs({ directory: d, mine: true })), [mine.id]);
});

test("容器带 n/m 进度（FR-G3）", () => {
  const d = repo();
  const parent = runAdd({ directory: d, title: "container" });
  const a = runAdd({ directory: d, title: "a", parent: parent.id });
  runAdd({ directory: d, title: "b", parent: parent.id });
  closeTask(d, a.id);
  const dto = runLs({ directory: d, all: true }).tasks.find((t) => t.id === parent.id);
  assert.deepEqual(dto?.child_progress, { closed: 1, total: 2 });
  assert.equal(runLs({ directory: d, all: true }).tasks.find((t) => t.id === a.id)?.child_progress,
    undefined, "叶子任务没有 children 字段");
});

test("输出顺序符合 spec §7.4", () => {
  const d = repo();
  const a = runAdd({ directory: d, title: "first" });
  const b = runAdd({ directory: d, title: "second" });
  assert.deepEqual(ids(runLs({ directory: d })), [a.id, b.id], "创建顺序即 rank 顺序");
});

test("--json 经 DTO 映射，字段名跟格式规格走", () => {
  const d = repo();
  const blocker = runAdd({ directory: d, title: "blocker" });
  runAdd({ directory: d, title: "t", labels: ["auth"], blockedBy: [blocker.id] });
  const parsed = JSON.parse(renderJson(runLs({ directory: d }))) as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(parsed), "FR-T2 明文：--json 输出数组，不套信封");
  const dto = parsed.find((t) => t["title"] === "t");
  assert.ok(dto);
  for (const key of ["id", "title", "status", "rank", "labels", "blocked_by", "ready", "blocked", "stale", "mine", "unverified"]) {
    assert.ok(key in dto, `--json 缺少字段 ${key}`);
  }
  assert.equal(dto["blocked"], true);
  assert.equal(dto["ready"], false);
  assert.deepEqual(dto["labels"], ["auth"]);
  assert.equal(dto["resolution"], undefined, "没有 resolution 的任务不该冒出这个键");
});

test("输出是英文，且空账本有明确提示", () => {
  const d = repo();
  const out = renderText(runLs({ directory: d }));
  assert.doesNotMatch(out, /[一-鿿]/, "CLI 输出 MUST 是英文");
  assert.match(out, /No tasks/i);
  assert.equal(renderText(runLs({ directory: d }), { quiet: true }), "", "--quiet 下空结果不出声");
});

test("stale 的 in_progress 任务在 ready 队列里且被标记（spec §7.5 末句）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "abandoned" });
  claimTask(d, t.id, "someone@elsewhere", "2020-01-01T00:00:00Z");
  const dto = runLs({ directory: d, ready: true }).tasks.find((x) => x.id === t.id);
  assert.ok(dto, "陈旧的 in_progress 任务必须出现在 ready 队列");
  assert.equal(dto.stale, true, "并且被标记为 stale");
  assert.match(renderText(runLs({ directory: d, ready: true })), /stale/i, "文本输出也要标出来");
});

test("不合法的任务文件被单独报告，不混进正常列表", () => {
  // readTasks 不丢弃坏文件——它们带着 parseError 进结果（doctor 靠这个报告损坏）。
  // ls 若照单全收，会列出一条标题为空、状态为空的幽灵任务；若悄悄丢掉，
  // agent 会以为这个任务不存在，转头又建一个重复的。两者都不行，所以单独报。
  const d = repo();
  const ok = runAdd({ directory: d, title: "fine" });
  writeFileSync(join(d, ".todopi", "tasks", "tp-zzzzzz.md"), "no envelope here\n");
  const r = runLs({ directory: d });
  assert.deepEqual(ids(r), [ok.id], "坏文件不出现在任务列表里");
  assert.deepEqual(r.invalid, ["tp-zzzzzz"]);
  assert.equal(renderText(r).includes("tp-zzzzzz"), false, "诊断不进 stdout");
  assert.match(renderDiagnostics(r), /tp-zzzzzz/, "但必须在 stderr 上看得见");
  assert.match(renderDiagnostics(r), /doctor/, "并且指向能查明白的命令");
});

test("任务多到几十万条时渲染不炸栈", () => {
  // renderText 要算 id 的最大宽度。用 Math.max(...ids) 在十万量级会 RangeError，
  // 而 import beads 第一天就可能造出这种规模的账本。
  const tasks = Array.from({ length: 200_000 }, (_, i) => ({
    id: `tp-${String(i).padStart(6, "0")}`, title: "t", status: "open",
    blocked_by: [], labels: [], created: "", updated: "",
    ready: true, blocked: false, stale: false, mine: false, unverified: false,
  }));
  assert.doesNotThrow(() => renderText({ tasks, total: tasks.length, invalid: [] }));
});

test("parseLimit 从**字符串**出发拒绝所有非十进制非负整数", () => {
  // 这条是 Codex 评审抓到的：原先的用例直接往 runLs 塞 number，
  // 而真正有缺陷的是 CLI 那层的 Number.parseInt——它把 "1.5" 读成 1、
  // "1foo" 读成 1、"0x10" 读成 0。于是用例全绿而边界是坏的。
  for (const bad of ["1.5", "1foo", "0x10", "1e3", " 2", "2 ", "-1", "+3", "", "abc", "01", "١٢"]) {
    assert.throws(() => parseLimit(bad),
      (e: unknown) => (e as { code: number }).code === EXIT.usage, `--limit ${JSON.stringify(bad)} 应当被拒`);
  }
  assert.equal(parseLimit("0"), 0);
  assert.equal(parseLimit("2"), 2);
  assert.equal(parseLimit("100"), 100);
});

test("--open 是可以显式给出的模式，不只是默认行为（FR-T2）", () => {
  const d = repo();
  const open = runAdd({ directory: d, title: "open" });
  const done = runAdd({ directory: d, title: "done" });
  closeTask(d, done.id);
  assert.deepEqual(ids(runLs({ directory: d, open: true })), [open.id]);
  assert.deepEqual(ids(runLs({ directory: d, open: true })), ids(runLs({ directory: d })),
    "--open 与默认一致");
  assert.throws(() => runLs({ directory: d, open: true, closed: true }),
    (e: unknown) => (e as { code: number }).code === EXIT.usage, "--open 也参与互斥校验");
});

test("forced=true 完成的任务标为 unverified（FR-D3 / spec §5.3.3）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "rushed" });
  closeTask(d, t.id);
  appendLog(d, t.id, "- 2026-09-14T11:02:00Z sean done forced=true: no time");
  const dto = runLs({ directory: d, closed: true }).tasks.find((x) => x.id === t.id);
  assert.equal(dto?.unverified, true);
  assert.match(renderText(runLs({ directory: d, closed: true })), /\[unverified\]/);
});

test("正常完成的任务不是 unverified", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "proper" });
  closeTask(d, t.id);
  appendLog(d, t.id, "- 2026-09-14T11:02:00Z sean done verify=pass commit=3f2a1c9");
  assert.equal(runLs({ directory: d, closed: true }).tasks[0]?.unverified, false);
});

test("字段非法的文件被挡下，但「字段合法、组合非法」的照常列出", () => {
  // 这条线是刻意划的：envelope / invariant-1 / field 说的是某个字段本身不合法，
  // 这样的文件没法渲染也没法派生；invariant-2/3/7/8 说的是字段都合法但组合非法
  // （open 却带 assignee），那种任务照样能渲染，按 spec §7 派生的结果也是对的，
  // 报告它们是 doctor 的职责。
  const d = repo();
  const good = runAdd({ directory: d, title: "fine" });
  // 字段非法：缺 title / status
  writeFileSync(join(d, ".todopi", "tasks", "tp-nofld1.md"), '---\nid: "tp-nofld1"\n---\n\nbody\n');
  // 组合非法：open 却带 assignee（不变量 3）
  const odd = runAdd({ directory: d, title: "open with assignee" });
  patch(d, odd.id, (l) => (l.startsWith("status:") ? 'status: "open"\nassignee: "sean"' : l));

  const r = runLs({ directory: d });
  assert.deepEqual(r.invalid, ["tp-nofld1"], "只有字段非法的进 invalid");
  assert.ok(ids(r).includes(odd.id), "组合非法的照常列出——那是 doctor 的地盘");
  assert.ok(ids(r).includes(good.id));
});

function appendLog(dir: string, id: string, line: string): void {
  const p = join(dir, ".todopi", "tasks", `${id}.md`);
  const src = readFileSync(p, "utf8");
  writeFileSync(p, src.includes("## Log") ? `${src.trimEnd()}\n${line}\n` : `${src.trimEnd()}\n\n## Log\n\n${line}\n`);
}
