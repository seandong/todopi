import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { runLs } from "../../src/commands/ls.ts";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { renderText, renderJson } from "../../src/output/render/ls.ts";
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
  assert.deepEqual(dto?.children, { closed: 1, total: 2 });
  assert.equal(runLs({ directory: d, all: true }).tasks.find((t) => t.id === a.id)?.children,
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
  const parsed = JSON.parse(renderJson(runLs({ directory: d }))) as
    { tasks: Array<Record<string, unknown>>; total: number; unreadable: string[] };
  const dto = parsed.tasks.find((t) => t["title"] === "t");
  assert.ok(dto);
  for (const key of ["id", "title", "status", "rank", "labels", "blocked_by", "ready", "blocked", "stale", "mine"]) {
    assert.ok(key in dto, `--json 缺少字段 ${key}`);
  }
  assert.equal(dto["blocked"], true);
  assert.equal(dto["ready"], false);
  assert.deepEqual(dto["labels"], ["auth"]);
  assert.equal(dto["resolution"], undefined, "没有 resolution 的任务不该冒出这个键");
  assert.ok(Array.isArray(parsed.unreadable));
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

test("读不出来的任务文件被单独报告，不混进正常列表", () => {
  // readTasks 不丢弃坏文件——它们带着 parseError 进结果（doctor 靠这个报告损坏）。
  // ls 若照单全收，会列出一条标题为空、状态为空的幽灵任务；若悄悄丢掉，
  // agent 会以为这个任务不存在，转头又建一个重复的。两者都不行，所以单独报。
  const d = repo();
  const ok = runAdd({ directory: d, title: "fine" });
  writeFileSync(join(d, ".todopi", "tasks", "tp-zzzzzz.md"), "no envelope here\n");
  const r = runLs({ directory: d });
  assert.deepEqual(ids(r), [ok.id], "坏文件不出现在任务列表里");
  assert.deepEqual(r.unreadable, ["tp-zzzzzz"]);
  assert.match(renderText(r), /tp-zzzzzz/, "但必须在输出里看得见");
  assert.match(renderText(r), /doctor/, "并且指向能查明白的命令");
  assert.match(renderText(r, { quiet: true }), /tp-zzzzzz/, "--quiet 压提示不压问题");
});

test("任务多到几十万条时渲染不炸栈", () => {
  // renderText 要算 id 的最大宽度。用 Math.max(...ids) 在十万量级会 RangeError，
  // 而 import beads 第一天就可能造出这种规模的账本。
  const tasks = Array.from({ length: 200_000 }, (_, i) => ({
    id: `tp-${String(i).padStart(6, "0")}`, title: "t", status: "open",
    blocked_by: [], labels: [], created: "", updated: "",
    ready: true, blocked: false, stale: false, mine: false,
  }));
  assert.doesNotThrow(() => renderText({ tasks, total: tasks.length, unreadable: [] }));
});
