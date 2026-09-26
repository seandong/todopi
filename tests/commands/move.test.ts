import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runLs } from "../../src/commands/ls.ts";
import { runMove } from "../../src/commands/move.ts";
import { runClaim } from "../../src/commands/claim.ts";
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
  // 比 inode 与 mtime，不比内容：只比内容的话，一个把邻居原样重写一遍的实现也能通过（评审指出）。
  const dir = join(d, ".todopi", "tasks");
  // inode 抓原子写（每次换一个），mtime 抓原地写（writeFileSync 不换 inode）。
  const inodes = () => new Map(readdirSync(dir).map((f) => {
    const st = statSync(join(dir, f));
    return [f, `${st.ino}:${st.mtimeMs}`];
  }));
  const before = inodes();
  runMove({ directory: d, id: ids["c"]!, before: ids["b"]!, actor: ME });
  const after = inodes();
  // 先比文件名集合：只遍历操作前的文件名，会漏掉意外新建的文件（评审指出）。
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), "文件多了或少了");
  const changed = [...before.keys()].filter((f) => before.get(f) !== after.get(f));
  assert.deepEqual(changed, [`${ids["c"]}.md`], "写了被挪任务之外的文件");
  assert.match(read(d, ids["c"]!).trimEnd().split("\n").at(-1)!, /^- \S+Z me@host moved$/);
});

test("--after Y 落在 Y 与它**真正的**下一个之间 —— 同 rank 并列按 id 破", () => {
  // §7.4：rank 相同按 id 排。两个 worktree 各自 add 就会撞出相同的 rank。Y 与下一个共用 rank 时，
  // 中间放不下新字符串；被挪的任务 id 恰好夹在两者之间才能靠共用 rank 落进去，否则拒绝并点名两个。
  // id 是随机的，所以按 id 排序后再分配角色：s1、s2 共用 rank，s0 与 s3 分别是 id 在外、在中间以外的挪动者。
  const d = repo();
  const [s0, s1, s2, s3] = Object.values(abcd(d)).sort();
  const setRank = (id: string, r: string) => edit(d, id, (x) => x.replace(/^rank: ".*"$/m, `rank: "${r}"`));
  setRank(s1!, "m"); setRank(s2!, "m"); setRank(s0!, "t"); setRank(s3!, "v");
  const before = snapshot(d);
  assert.throws(() => runMove({ directory: d, id: s3!, after: s1!, actor: ME }),
    (e: unknown) => code(EXIT.usage)(e) && (e as Error).message.includes(s1!) && (e as Error).message.includes(s2!));
  assert.deepEqual(snapshot(d), before, "拒绝时什么都不该写");
});

test("邻居之间放不下新 rank 时，和一侧共用 rank、靠 id 落在中间：有解，只改一个文件（第九轮评审）", () => {
  const d = repo();
  const [s0, s1, s2, s3] = Object.values(abcd(d)).sort();
  const setRank = (id: string, r: string) => edit(d, id, (x) => x.replace(/^rank: ".*"$/m, `rank: "${r}"`));
  // 顺序：s0(m) s2(m) s3(t) s1(v)。把 s1 挪到 s0 之后：只有 rank "m" 且 id 在 s0 与 s2 之间才行。
  setRank(s0!, "m"); setRank(s2!, "m"); setRank(s3!, "t"); setRank(s1!, "v");
  const before = snapshot(d);
  runMove({ directory: d, id: s1!, after: s0!, actor: ME });
  assert.deepEqual(runLs({ directory: d, all: true }).tasks.map((t) => t.id), [s0, s1, s2, s3]);
  const after = snapshot(d);
  assert.deepEqual([...after.keys()].filter((f) => after.get(f) !== before.get(f)), [`${s1}.md`]);
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("同上，共用的是后继的 rank：32 位只差末位的两个邻居之间，id 更小的挪动者排在后继前面", () => {
  const d = repo();
  const [s0, s1, s2, s3] = Object.values(abcd(d)).sort();
  const setRank = (id: string, r: string) => edit(d, id, (x) => x.replace(/^rank: ".*"$/m, `rank: "${r}"`));
  // 顺序 s3(…0) s2(…1) s0(t) s1(v)。s1 挪到 s2 之前：共用 s3 的 rank 要 id > s3，不行；共用 s2 的要 id < s2，行。
  setRank(s3!, `${"a".repeat(31)}0`); setRank(s2!, `${"a".repeat(31)}1`); setRank(s0!, "t"); setRank(s1!, "v");
  runMove({ directory: d, id: s1!, before: s2!, actor: ME });
  assert.deepEqual(runLs({ directory: d, all: true }).tasks.map((t) => t.id), [s3, s1, s2, s0]);
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("相对一个没有 rank 的任务挪：拒绝并指向 doctor --fix", () => {
  // 混合种群下 --after 无解（FR-T5）：有 rank 的任务整段排在无 rank 的之前。
  const d = repo();
  const ids = abcd(d);
  edit(d, ids["b"]!, (s) => s.replace(/^rank: ".*"\n/m, ""));
  assert.throws(() => runMove({ directory: d, id: ids["a"]!, after: ids["b"]!, actor: ME }),
    (e: unknown) => code(EXIT.usage)(e) && /doctor --fix/.test((e as Error).message));
});

test("紧贴第一个无 rank 任务之前：有解，排到有 rank 那段的末尾，只改一个文件（第八轮评审）", () => {
  // b、c 没有 rank：顺序是 a、d（有 rank），然后 b、c（按 created）。「b 之前」就是有 rank 那段的末尾；
  // 「c 之前」夹在两个无 rank 任务之间，给谁一个 rank 都到不了那儿——无解。
  const d = repo();
  const ids = abcd(d);
  // 无 rank 的按 created 排；同一秒建的会退到随机 id 上，所以显式错开。
  ["b", "c"].forEach((t, k) => edit(d, ids[t]!, (s) => s.replace(/^rank: ".*"\n/m, "")
    .replace(/^created: ".*"$/m, `created: "2020-01-01T00:00:0${k}Z"`)));
  assert.deepEqual(order(d), ["a", "d", "b", "c"]);
  const before = snapshot(d);
  runMove({ directory: d, id: ids["a"]!, before: ids["b"]!, actor: ME });
  assert.deepEqual(order(d), ["d", "a", "b", "c"]);
  const after = snapshot(d);
  assert.deepEqual([...after.keys()].filter((f) => after.get(f) !== before.get(f)), [`${ids["a"]}.md`]);
  assert.throws(() => runMove({ directory: d, id: ids["d"]!, before: ids["c"]!, actor: ME }),
    (e: unknown) => code(EXIT.usage)(e) && /no position before/.test((e as Error).message));
  assert.equal(runDoctor({ directory: d }).ok, true);
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
  setRank(ids["a"]!, rankBetween(null, rankOf(ids["b"]!))!);
  runMove({ directory: d, id: ids["d"]!, before: ids["b"]!, actor: ME });
  assert.ok(rankOf(ids["a"]!) < rankOf(ids["d"]!) && rankOf(ids["d"]!) < rankOf(ids["b"]!),
    `--before 的新 rank 没有严格落在前驱与目标之间：${rankOf(ids["a"]!)} / ${rankOf(ids["d"]!)} / ${rankOf(ids["b"]!)}`);

  // --after b，后继的 rank 紧贴 b
  const next = runLs({ directory: d, all: true }).tasks.map((t) => t.id);
  const after = next[next.indexOf(ids["b"]!) + 1]!;
  setRank(after, rankBetween(rankOf(ids["b"]!), null)!);
  const mover = next.find((id) => id !== ids["b"] && id !== after)!;
  runMove({ directory: d, id: mover, after: ids["b"]!, actor: ME });
  assert.ok(rankOf(ids["b"]!) < rankOf(mover) && rankOf(mover) < rankOf(after),
    `--after 的新 rank 没有严格落在目标与后继之间：${rankOf(ids["b"]!)} / ${rankOf(mover)} / ${rankOf(after)}`);
});


test("手写的、规格合法但库不认的 rank：add 与 move 都照常工作，不抛 invalid order key", () => {
  // spec §5.2 允许 rank: "a"，doctor 判为干净；fractional-indexing 却不认它。曾经 add 与
  // move --top 都在这样的合法账本上直接崩（F10 评审找出 move 那半，add 那半是顺手查出来的）。
  const d = repo();
  const ids = abcd(d);
  edit(d, ids["a"]!, (s) => s.replace(/^rank: ".*"$/m, 'rank: "a"'));
  edit(d, ids["d"]!, (s) => s.replace(/^rank: ".*"$/m, 'rank: "zz"'));
  assert.equal(runDoctor({ directory: d }).ok, true, "夹具本身应当是合法账本");
  runMove({ directory: d, id: ids["c"]!, top: true, actor: ME });
  assert.equal(order(d)[0], "c");
  const e = runAdd({ directory: d, title: "e", actor: ME });
  assert.equal(order(d).at(-1), "e", "新任务应当排在最后");
  assert.ok(e.id);
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("两个邻居之间真的放不下（32 位、只差末位）：拒绝并点名，什么都不写", () => {
  // 被挪的任务 id 必须夹在两者之外的那一侧，否则它能和一侧共用 rank 落进去（见上一条）。
  // 顺序 lo=s2(…0) hi=s0(…1)：共用 lo 的 rank 要 id > s2，共用 hi 的要 id < s0——s1 两样都不满足。
  const d = repo();
  const [s0, s1, s2, s3] = Object.values(abcd(d)).sort();
  const setRank = (id: string, r: string) => edit(d, id, (x) => x.replace(/^rank: ".*"$/m, `rank: "${r}"`));
  setRank(s2!, `${"a".repeat(31)}0`); setRank(s0!, `${"a".repeat(31)}1`); setRank(s1!, "t"); setRank(s3!, "v");
  const before = snapshot(d);
  assert.throws(() => runMove({ directory: d, id: s1!, after: s2!, actor: ME }),
    (e: unknown) => code(EXIT.usage)(e) && /32 characters/.test((e as Error).message)
      && (e as Error).message.includes(s2!) && (e as Error).message.includes(s0!));
  assert.deepEqual(snapshot(d), before);
});

test("已经在目标位置、锚点又没有 rank：照样是什么都不做，而不是报「没有 rank」（第九轮评审）", () => {
  const d = repo();
  const ids = abcd(d);
  ["b", "c", "d"].forEach((t, k) => edit(d, ids[t]!, (x) => x.replace(/^rank: ".*"\n/m, "")
    .replace(/^created: ".*"$/m, `created: "2020-01-01T00:00:0${k}Z"`)));
  assert.deepEqual(order(d), ["a", "b", "c", "d"]);
  const before = snapshot(d);
  assert.equal(runMove({ directory: d, id: ids["c"]!, before: ids["d"]!, actor: ME }).changed, false);
  assert.equal(runMove({ directory: d, id: ids["d"]!, after: ids["c"]!, actor: ME }).changed, false);
  assert.deepEqual(snapshot(d), before);
});

test("被挪的任务在别人手里：退出 3，什么都不写（FR-C6）", () => {
  const d = repo();
  const ids = abcd(d);
  runClaim({ directory: d, id: ids["c"]!, actor: "other@host" });
  const before = snapshot(d);
  assert.throws(() => runMove({ directory: d, id: ids["c"]!, top: true, actor: ME }), code(EXIT.conflict));
  assert.deepEqual(snapshot(d), before);
});
