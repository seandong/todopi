import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { runDep } from "../../src/commands/dep.ts";
import { runDoctor } from "../../src/commands/doctor.ts";
import { EXIT, CliError } from "../../src/exit.ts";

const ME = "me@host";
const OTHER = "other@host";

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-dep-"));
  runInit({ directory: d, prefix: "tp" });
  return d;
}
const taskPath = (d: string, id: string) => join(d, ".todopi", "tasks", `${id}.md`);
const read = (d: string, id: string) => readFileSync(taskPath(d, id), "utf8");
const edit = (d: string, id: string, f: (s: string) => string) => writeFileSync(taskPath(d, id), f(read(d, id)));
const blockedBy = (d: string, id: string) => {
  const m = /^blocked_by: \[(.*)\]$/m.exec(read(d, id));
  return m === null ? [] : m[1]!.split(", ").map((s) => JSON.parse(s) as string);
};
const lastLog = (d: string, id: string) => read(d, id).trimEnd().split("\n").at(-1)!;
const code = (c: number) => (e: unknown) => e instanceof CliError && e.code === c;

test("dep add：写进 blocked_by，排序去重，记 edited fields=blocked_by", () => {
  const d = repo();
  const [a, b, c] = ["a", "b", "c"].map((t) => runAdd({ directory: d, title: t, actor: ME }).id);
  // 按字典序**倒着**加：id 是随机的，顺着加的话不排序的实现有一半概率碰巧对。
  const [lo, hi] = [b!, c!].sort();
  runDep({ directory: d, op: "add", id: a!, on: hi!, actor: ME });
  runDep({ directory: d, op: "add", id: a!, on: lo!, actor: ME });
  assert.deepEqual(blockedBy(d, a!), [lo!, hi!], "blocked_by 是集合：写回时排序");
  assert.match(lastLog(d, a!), /^- \S+Z me@host edited fields=blocked_by$/);
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("dep rm：删掉那条边；删到空时字段整个去掉", () => {
  const d = repo();
  const a = runAdd({ directory: d, title: "a", actor: ME }).id;
  const b = runAdd({ directory: d, title: "b", actor: ME }).id;
  runDep({ directory: d, op: "add", id: a, on: b, actor: ME });
  runDep({ directory: d, op: "rm", id: a, on: b, actor: ME });
  assert.deepEqual(blockedBy(d, a), []);
  assert.doesNotMatch(read(d, a), /^blocked_by:/m, "空的 blocked_by 应当整个省略");
});

test("成环拒绝：退出 1，报错里有环的路径，文件不动", () => {
  // FR-G1：有环则拒绝并打印环。判定在写入门禁 validateWrite 里（与 doctor 同一个查环器）。
  const d = repo();
  const a = runAdd({ directory: d, title: "a", actor: ME }).id;
  const b = runAdd({ directory: d, title: "b", actor: ME }).id;
  const c = runAdd({ directory: d, title: "c", actor: ME }).id;
  runDep({ directory: d, op: "add", id: a, on: b, actor: ME });
  runDep({ directory: d, op: "add", id: b, on: c, actor: ME });
  const before = read(d, c);
  assert.throws(() => runDep({ directory: d, op: "add", id: c, on: a, actor: ME }),
    (e: unknown) => code(EXIT.usage)(e) && /cycle/.test((e as Error).message)
      && [a, b, c].every((id) => (e as Error).message.includes(id)));
  assert.equal(read(d, c), before);
});

test("自依赖在碰图之前就拒绝", () => {
  const d = repo();
  const a = runAdd({ directory: d, title: "a", actor: ME }).id;
  assert.throws(() => runDep({ directory: d, op: "add", id: a, on: a, actor: ME }),
    (e: unknown) => code(EXIT.usage)(e) && /itself/.test((e as Error).message));
});

test("--on 不存在：退出 1 并点名", () => {
  const d = repo();
  const a = runAdd({ directory: d, title: "a", actor: ME }).id;
  assert.throws(() => runDep({ directory: d, op: "add", id: a, on: "tp-zzzzzz", actor: ME }),
    (e: unknown) => code(EXIT.usage)(e) && /tp-zzzzzz/.test((e as Error).message));
});

test("幂等：已有的边再 add、没有的边 rm —— 退出 0，不写文件", () => {
  const d = repo();
  const a = runAdd({ directory: d, title: "a", actor: ME }).id;
  const b = runAdd({ directory: d, title: "b", actor: ME }).id;
  runDep({ directory: d, op: "add", id: a, on: b, actor: ME });
  const before = read(d, a);
  assert.equal(runDep({ directory: d, op: "add", id: a, on: b, actor: ME }).changed, false);
  const c = runAdd({ directory: d, title: "c", actor: ME }).id;
  assert.equal(runDep({ directory: d, op: "rm", id: a, on: c, actor: ME }).changed, false);
  assert.equal(read(d, a), before);
});

test("已关闭任务的依赖不能改：退出 2", () => {
  // 改一个已关闭任务的依赖，等于改写它当时是在什么条件下被接受的。
  const d = repo();
  const a = runAdd({ directory: d, title: "a", actor: ME }).id;
  const b = runAdd({ directory: d, title: "b", actor: ME }).id;
  edit(d, a, (s) => s.replace(/^status: "open"$/m, 'status: "closed"\nresolution: "done"'));
  assert.throws(() => runDep({ directory: d, op: "add", id: a, on: b, actor: ME }), code(EXIT.gate));
});

test("dep 不查归属（PRD FR-C6 的严格匹配名单里没有它）", () => {
  // 规划操作，与 add --blocked-by 同类。
  const d = repo();
  const a = runAdd({ directory: d, title: "a", actor: ME }).id;
  const b = runAdd({ directory: d, title: "b", actor: ME }).id;
  runClaim({ directory: d, id: a, actor: OTHER });
  runDep({ directory: d, op: "add", id: a, on: b, actor: ME });
  assert.deepEqual(blockedBy(d, a), [b]);
});
