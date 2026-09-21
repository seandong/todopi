import { test } from "node:test";
import assert from "node:assert";
import { compareTasks, sortTasks } from "../../src/domain/order.ts";
import type { TaskFile } from "../../src/domain/types.ts";

function task(id: string, fm: Record<string, unknown> = {}): TaskFile {
  return {
    path: `tasks/${id}.md`, idFromFilename: id,
    frontmatter: { id, title: "T", status: "open", created: "2026-09-14T09:00:00Z",
      updated: "2026-09-14T09:00:00Z", ...fm },
    body: "", raw: "",
  };
}
const ids = (ts: TaskFile[]) => ts.map((t) => t.idFromFilename);

test("有 rank 的排在无 rank 的前面（spec §7.4 的两组）", () => {
  const ranked = task("tp-000002", { rank: "zzz" });
  const unranked = task("tp-000001");
  assert.deepEqual(ids(sortTasks([unranked, ranked])), ["tp-000002", "tp-000001"]);
});

test("有 rank 的按码点升序，**不是** localeCompare", () => {
  // 实测：localeCompare 把 a0 排在 A0 前，码点比较把 A0 排在前。
  // spec §7.4 要求「ascending by codepoint comparison」。
  const sorted = sortTasks([
    task("tp-lower", { rank: "a0" }),
    task("tp-upper", { rank: "A0" }),
  ]);
  assert.deepEqual(ids(sorted), ["tp-upper", "tp-lower"],
    "A0 的码点小于 a0；用 localeCompare 会得到相反的顺序");
});

test("无 rank 的按 created 升序", () => {
  const sorted = sortTasks([
    task("tp-000002", { created: "2026-09-14T10:00:00Z" }),
    task("tp-000001", { created: "2026-09-14T09:00:00Z" }),
  ]);
  assert.deepEqual(ids(sorted), ["tp-000001", "tp-000002"]);
});

test("并列时按 id —— 不能依赖 sort 的稳定性", () => {
  // Array.prototype.sort 自 ES2019 起稳定，但稳定性保留的是「输入顺序」，
  // 而输入顺序来自 readdirSync。spec §7.4 明确 ties by id。
  const same = { rank: "i0", created: "2026-09-14T09:00:00Z" };
  assert.deepEqual(
    ids(sortTasks([task("tp-000003", same), task("tp-000001", same), task("tp-000002", same)])),
    ["tp-000001", "tp-000002", "tp-000003"]);
});

test("排序是确定性的：任意排列的输入得到同一个输出", () => {
  const tasks = [
    task("tp-000001", { rank: "i1" }), task("tp-000002", { rank: "i0" }),
    task("tp-000003", { created: "2026-09-14T08:00:00Z" }),
    task("tp-000004", { created: "2026-09-14T07:00:00Z" }),
    task("tp-000005", { rank: "i2" }),
  ];
  const expected = ids(sortTasks(tasks));
  // 真正打乱：Fisher-Yates 用确定性的伪随机，保证每轮排列不同
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let round = 0; round < 50; round++) {
    const shuffled = [...tasks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    assert.deepEqual(ids(sortTasks(shuffled)), expected, `第 ${round} 次打乱后顺序变了`);
  }
});

test("compareTasks 是全序：任意两个不同任务恰有一个在前", () => {
  const tasks = [
    task("tp-000001", { rank: "i0" }), task("tp-000002", { rank: "i1" }),
    task("tp-000003"), task("tp-000004", { created: "2026-09-14T10:00:00Z" }),
  ];
  for (const a of tasks) {
    assert.equal(compareTasks(a, a), 0, "自反：与自己比较为 0");
    for (const b of tasks) {
      if (a === b) continue;
      const ab = compareTasks(a, b), ba = compareTasks(b, a);
      assert.ok(ab !== 0, `${a.idFromFilename} 与 ${b.idFromFilename} 不该并列`);
      assert.equal(Math.sign(ab), -Math.sign(ba), "反对称");
    }
  }
});

test("compareTasks 满足传递性", () => {
  const tasks = [
    task("tp-000001", { rank: "i0" }), task("tp-000002", { rank: "i1" }),
    task("tp-000003", { rank: "i2" }), task("tp-000004"),
    task("tp-000005", { created: "2026-09-14T10:00:00Z" }),
  ];
  for (const a of tasks) for (const b of tasks) for (const c of tasks) {
    if (compareTasks(a, b) < 0 && compareTasks(b, c) < 0) {
      assert.ok(compareTasks(a, c) < 0,
        `传递性失败：${a.idFromFilename} < ${b.idFromFilename} < ${c.idFromFilename}`);
    }
  }
});

test("sortTasks 不改动入参", () => {
  const tasks = [task("tp-000002", { rank: "i1" }), task("tp-000001", { rank: "i0" })];
  const before = ids(tasks);
  sortTasks(tasks);
  assert.deepEqual(ids(tasks), before, "必须返回新数组");
});

test("rank 是空字符串时按无 rank 处理", () => {
  const sorted = sortTasks([task("tp-000001", { rank: "" }), task("tp-000002", { rank: "zzz" })]);
  assert.deepEqual(ids(sorted), ["tp-000002", "tp-000001"]);
});
