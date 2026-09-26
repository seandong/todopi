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
    (e: unknown) => {
      // 断言一条**连续、闭合**的有向路径，而不只是三个 id 各自出现（`cycle: a,b,c` 也能过那种断言）。
      const m = /cycle in the blocked_by graph: ((?:tp-[0-9a-z]+ -> )+tp-[0-9a-z]+)/.exec((e as Error).message);
      if (!code(EXIT.usage)(e) || m === null) return false;
      const path = m[1]!.split(" -> ");
      const edges: Record<string, string> = { [a]: b, [b]: c, [c]: a };   // x 被 edges[x] 挡着
      return path.length === 4 && path[0] === path[3] && new Set(path.slice(0, 3)).size === 3
        && path.slice(0, 3).every((x, i) => edges[x] === path[i + 1]);
    });
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

test("被阻塞的任务在别人手里：退出 3，文件不动（FR-C6）", () => {
  // dep 改写的是被阻塞那个任务的文件与 Log。第一版以为它和 add --blocked-by 同类而不查——
  // 那个类比是错的：add 写的是新任务，dep 写的是别人正在做的任务（F10 评审）。
  const d = repo();
  const a = runAdd({ directory: d, title: "a", actor: ME }).id;
  const b = runAdd({ directory: d, title: "b", actor: ME }).id;
  runClaim({ directory: d, id: a, actor: OTHER });
  const before = read(d, a);
  assert.throws(() => runDep({ directory: d, op: "add", id: a, on: b, actor: ME }), code(EXIT.conflict));
  assert.equal(read(d, a), before);
});
