import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runLs } from "../../src/commands/ls.ts";
import { runMove } from "../../src/commands/move.ts";
import { runDoctor } from "../../src/commands/doctor.ts";
import { EXIT, CliError } from "../../src/exit.ts";

const ME = "me@host";

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-move-"));
  runInit({ directory: d, prefix: "tp" });
  return d;
}
const taskPath = (d: string, id: string) => join(d, ".todopi", "tasks", `${id}.md`);
const read = (d: string, id: string) => readFileSync(taskPath(d, id), "utf8");
const edit = (d: string, id: string, f: (s: string) => string) => writeFileSync(taskPath(d, id), f(read(d, id)));
const order = (d: string) => runLs({ directory: d, all: true }).tasks.map((t) => t.title);
const code = (c: number) => (e: unknown) => e instanceof CliError && e.code === c;
/** 账本里每个文件的内容快照，用来断言「只重写了一个文件」。 */
const snapshot = (d: string) => new Map(readdirSync(join(d, ".todopi", "tasks")).map((f) => [f, readFileSync(join(d, ".todopi", "tasks", f), "utf8")]));

function abcd(d: string): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const t of ["a", "b", "c", "d"]) ids[t] = runAdd({ directory: d, title: t, actor: ME }).id;
  return ids;
}

test("--top / --before / --after 把任务放到该在的位置", () => {
  const d = repo();
  const ids = abcd(d);
  runMove({ directory: d, id: ids["d"]!, top: true, actor: ME });
  assert.deepEqual(order(d), ["d", "a", "b", "c"]);
  runMove({ directory: d, id: ids["a"]!, after: ids["c"]!, actor: ME });
  assert.deepEqual(order(d), ["d", "b", "c", "a"]);
  runMove({ directory: d, id: ids["c"]!, before: ids["d"]!, actor: ME });
  assert.deepEqual(order(d), ["c", "d", "b", "a"]);
  runMove({ directory: d, id: ids["d"]!, after: ids["a"]!, actor: ME });   // 挪到最末
  assert.deepEqual(order(d), ["c", "b", "a", "d"]);
  // 目标两侧都有邻居的情形。**注意它们判别不出「忽略前驱 / 后继」**：generateKeyBetween
  // 给的是紧挨着目标的键，前驱离得远时错误实现也碰巧落对（突变实测）。那一条的判据在
  // 下面「新 rank 严格落在两个邻居之间」里。
  runMove({ directory: d, id: ids["d"]!, before: ids["a"]!, actor: ME });  // c b [d] a
  assert.deepEqual(order(d), ["c", "b", "d", "a"]);
  runMove({ directory: d, id: ids["c"]!, after: ids["b"]!, actor: ME });   // b [c] d a
  assert.deepEqual(order(d), ["b", "c", "d", "a"]);
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("只重写一个文件（FR-T5），并在它的 Log 里记 moved", () => {
  const d = repo();
  const ids = abcd(d);
  const before = snapshot(d);
  runMove({ directory: d, id: ids["c"]!, before: ids["b"]!, actor: ME });
  const after = snapshot(d);
  const changed = [...before.keys()].filter((f) => before.get(f) !== after.get(f));
  assert.deepEqual(changed, [`${ids["c"]}.md`], "改动了被挪任务之外的文件");
  assert.match(read(d, ids["c"]!).trimEnd().split("\n").at(-1)!, /^- \S+Z me@host moved$/);
});

test("--after Y 落在 Y 与它**真正的**下一个之间 —— 同 rank 并列按 id 破", () => {
  // §7.4：rank 相同按 id 排。两个 worktree 各自 add 就会撞出相同的 rank。
  // 若 Y 与下一个 rank 相同，两者之间没有字符串可插——拒绝，点名两个任务。
  const d = repo();
  const ids = abcd(d);
  const rankOf = (id: string) => /^rank: "(.*)"$/m.exec(read(d, id))![1]!;
  edit(d, ids["c"]!, (s) => s.replace(/^rank: ".*"$/m, `rank: "${rankOf(ids["b"]!)}"`));
  const [first, second] = [ids["b"]!, ids["c"]!].sort();
  const before = snapshot(d);
  assert.throws(() => runMove({ directory: d, id: ids["d"]!, after: first!, actor: ME }),
    (e: unknown) => code(EXIT.usage)(e) && (e as Error).message.includes(first!) && (e as Error).message.includes(second!));
  assert.deepEqual(snapshot(d), before, "拒绝时什么都不该写");
});

test("相对一个没有 rank 的任务挪：拒绝并指向 doctor --fix", () => {
  // 混合种群下 --after 无解（FR-T5）：有 rank 的任务整段排在无 rank 的之前。
  const d = repo();
  const ids = abcd(d);
  edit(d, ids["b"]!, (s) => s.replace(/^rank: ".*"\n/m, ""));
  assert.throws(() => runMove({ directory: d, id: ids["a"]!, after: ids["b"]!, actor: ME }),
    (e: unknown) => code(EXIT.usage)(e) && /doctor --fix/.test((e as Error).message));
});

test("已经在目标位置：退出 0，不写文件", () => {
  const d = repo();
  const ids = abcd(d);
  const before = snapshot(d);
  assert.equal(runMove({ directory: d, id: ids["a"]!, top: true, actor: ME }).changed, false);
  assert.equal(runMove({ directory: d, id: ids["c"]!, after: ids["b"]!, actor: ME }).changed, false);
  assert.equal(runMove({ directory: d, id: ids["b"]!, before: ids["c"]!, actor: ME }).changed, false);
  assert.deepEqual(snapshot(d), before);
});

test("参数错误：恰好一个方向、目标存在、不能相对自己", () => {
  const d = repo();
  const ids = abcd(d);
  assert.throws(() => runMove({ directory: d, id: ids["a"]!, actor: ME }), code(EXIT.usage));
  assert.throws(() => runMove({ directory: d, id: ids["a"]!, top: true, after: ids["b"]!, actor: ME }), code(EXIT.usage));
  assert.throws(() => runMove({ directory: d, id: ids["a"]!, after: "tp-zzzzzz", actor: ME }),
    (e: unknown) => code(EXIT.usage)(e) && /tp-zzzzzz/.test((e as Error).message));
  assert.throws(() => runMove({ directory: d, id: ids["a"]!, after: ids["a"]!, actor: ME }), code(EXIT.usage));
});

test("已关闭任务可以挪：重排显示顺序不改写证据", () => {
  const d = repo();
  const ids = abcd(d);
  edit(d, ids["d"]!, (s) => s.replace(/^status: "open"$/m, 'status: "closed"\nresolution: "done"'));
  runMove({ directory: d, id: ids["d"]!, top: true, actor: ME });
  assert.equal(order(d)[0], "d");
});

test("新 rank 严格落在两个邻居之间 —— 邻居的 rank 贴得再近也一样", async () => {
  // 只看顺序不够：generateKeyBetween(null, X) 给的是**紧挨着 X 之前**的键，所以「忽略前驱」
  // 的实现在前驱离 X 较远时也碰巧落对（突变实测逃掉过两次）。这里故意把前驱的 rank 设成
  // 恰好是那个紧挨着的键，错误的实现必然撞出相等的 rank。--after 与后继同理。
  const { rankBetween } = await import("../../src/format/emit.ts");
  const d = repo();
  const ids = abcd(d);
  const rankOf = (id: string) => /^rank: "(.*)"$/m.exec(read(d, id))![1]!;
  const setRank = (id: string, r: string) => edit(d, id, (s) => s.replace(/^rank: ".*"$/m, `rank: "${r}"`));

  // --before b，前驱 a 的 rank 紧贴 b
  setRank(ids["a"]!, rankBetween(null, rankOf(ids["b"]!)));
  runMove({ directory: d, id: ids["d"]!, before: ids["b"]!, actor: ME });
  assert.ok(rankOf(ids["a"]!) < rankOf(ids["d"]!) && rankOf(ids["d"]!) < rankOf(ids["b"]!),
    `--before 的新 rank 没有严格落在前驱与目标之间：${rankOf(ids["a"]!)} / ${rankOf(ids["d"]!)} / ${rankOf(ids["b"]!)}`);

  // --after b，后继的 rank 紧贴 b
  const next = runLs({ directory: d, all: true }).tasks.map((t) => t.id);
  const after = next[next.indexOf(ids["b"]!) + 1]!;
  setRank(after, rankBetween(rankOf(ids["b"]!), null));
  const mover = next.find((id) => id !== ids["b"] && id !== after)!;
  runMove({ directory: d, id: mover, after: ids["b"]!, actor: ME });
  assert.ok(rankOf(ids["b"]!) < rankOf(mover) && rankOf(mover) < rankOf(after),
    `--after 的新 rank 没有严格落在目标与后继之间：${rankOf(ids["b"]!)} / ${rankOf(mover)} / ${rankOf(after)}`);
});
