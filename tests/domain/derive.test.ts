import { test } from "node:test";
import assert from "node:assert";
import {
  indexTasks, isContainer, childProgress, isBlocked, isStale, isReady, isUnverified,
  type StaleInput,
} from "../../src/domain/derive.ts";
import type { TaskFile } from "../../src/domain/types.ts";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-09-14T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

function task(id: string, fm: Record<string, unknown> = {}): TaskFile {
  return {
    path: `tasks/${id}.md`, idFromFilename: id,
    frontmatter: {
      id, title: "T", status: "open", rank: "i0",
      created: "2026-09-14T09:00:00Z", updated: "2026-09-14T09:00:00Z", ...fm,
    },
    body: "", raw: "",
  };
}

/** 没有任何租约文件的机器——F05 之前这是唯一的情形。 */
const noLeases = (now = T0, leaseHours = 2): StaleInput =>
  ({ now, leaseHours, heartbeatAt: () => null });

test("children 与 blocks 是反向关系，由 index 推导", () => {
  const parent = task("tp-000001");
  const child = task("tp-000002", { parent: "tp-000001" });
  const blocked = task("tp-000003", { blocked_by: ["tp-000001"] });
  const ix = indexTasks([parent, child, blocked]);
  assert.deepEqual(ix.childrenOf.get("tp-000001")?.map((t) => t.idFromFilename), ["tp-000002"]);
  assert.deepEqual(ix.blocksOf.get("tp-000001")?.map((t) => t.idFromFilename), ["tp-000003"]);
});

test("容器 = 有一个以上子任务（spec §7.1）", () => {
  const ix = indexTasks([task("tp-000001"), task("tp-000002", { parent: "tp-000001" })]);
  assert.equal(isContainer(ix, ix.byId.get("tp-000001")!), true);
  assert.equal(isContainer(ix, ix.byId.get("tp-000002")!), false, "叶子不是容器");
});

test("容器的 n/m 进度只数直接子任务", () => {
  const ix = indexTasks([
    task("tp-000001"),
    task("tp-000002", { parent: "tp-000001", status: "closed", resolution: "done" }),
    task("tp-000003", { parent: "tp-000001" }),
    task("tp-000004", { parent: "tp-000002" }),
  ]);
  assert.deepEqual(childProgress(ix, ix.byId.get("tp-000001")!), { closed: 1, total: 2 });
});

test.describe("blocked（spec §7.2）", () => {
  const cases: Array<[string, TaskFile[], string, boolean]> = [
    ["无 blocked_by 不算被阻塞", [task("tp-000001")], "tp-000001", false],
    ["阻塞者未关闭 → 被阻塞",
      [task("tp-000001", { blocked_by: ["tp-000002"] }), task("tp-000002")], "tp-000001", true],
    ["阻塞者已关闭 → 不被阻塞（任何 resolution 都解除）",
      [task("tp-000001", { blocked_by: ["tp-000002"] }),
       task("tp-000002", { status: "closed", resolution: "wontfix" })], "tp-000001", false],
    ["多个阻塞者，只要有一个没关就算被阻塞",
      [task("tp-000001", { blocked_by: ["tp-000002", "tp-000003"] }),
       task("tp-000002", { status: "closed", resolution: "done" }), task("tp-000003")],
      "tp-000001", true],
    ["自己已关闭的任务不算被阻塞",
      [task("tp-000001", { blocked_by: ["tp-000002"], status: "closed", resolution: "done" }),
       task("tp-000002")], "tp-000001", false],
    ["阻塞者不存在时按未关闭处理 —— doctor 会另行报告悬空引用",
      [task("tp-000001", { blocked_by: ["tp-zzzzzz"] })], "tp-000001", true],
  ];
  for (const [name, tasks, id, expected] of cases) {
    test(name, () => {
      const ix = indexTasks(tasks);
      assert.equal(isBlocked(ix, ix.byId.get(id)!), expected);
    });
  }
});

test.describe("stale（spec §7.3）", () => {
  test("只有 in_progress 的任务才谈得上 stale", () => {
    for (const status of ["open", "closed"]) {
      const t = task("tp-000001", {
        status, ...(status === "closed" ? { resolution: "done" } : {}),
        updated: iso(T0 - 10 * HOUR),
      });
      assert.equal(isStale(t, noLeases()), false, `${status} 不该被判 stale`);
    }
  });

  test("本机有租约时看心跳，不看 updated（spec §7.3 第一条）", () => {
    const t = task("tp-000001", { status: "in_progress", assignee: "a", updated: iso(T0 - 10 * HOUR) });
    const fresh: StaleInput = { now: T0, leaseHours: 2, heartbeatAt: () => T0 - 60_000 };
    assert.equal(isStale(t, fresh), false, "心跳新鲜时不看 updated");
    const old: StaleInput = { now: T0, leaseHours: 2, heartbeatAt: () => T0 - 3 * HOUR };
    assert.equal(isStale(t, old), true);
  });

  test("本机没有租约时看 updated（spec §7.3 第二条：另一台机器或新克隆）", () => {
    const recent = task("tp-000001", { status: "in_progress", assignee: "a", updated: iso(T0 - HOUR) });
    assert.equal(isStale(recent, noLeases()), false);
    const old = task("tp-000002", { status: "in_progress", assignee: "a", updated: iso(T0 - 3 * HOUR) });
    assert.equal(isStale(old, noLeases()), true);
  });

  test("边界：恰好等于 lease_hours 不算 stale（spec 写的是「超过」）", () => {
    const t = task("tp-000001", { status: "in_progress", assignee: "a", updated: iso(T0 - 2 * HOUR) });
    assert.equal(isStale(t, noLeases(T0, 2)), false, "恰好 2 小时不算超过");
    const justOver = task("tp-000002", { status: "in_progress", assignee: "a", updated: iso(T0 - 2 * HOUR - 1000) });
    assert.equal(isStale(justOver, noLeases(T0, 2)), true);
  });

  test("updated 无法解析时不判 stale —— 那是 doctor 的问题，不是 ls 的", () => {
    const t = task("tp-000001", { status: "in_progress", assignee: "a", updated: "not a timestamp" });
    assert.equal(isStale(t, noLeases()), false);
  });
});

test.describe("ready（spec §7.5 的三个条件）", () => {
  test("三条都满足 → ready", () => {
    const ix = indexTasks([task("tp-000001")]);
    assert.equal(isReady(ix, ix.byId.get("tp-000001")!, noLeases()), true);
  });

  test("条件 1：容器永不 ready（FR-G3）", () => {
    const ix = indexTasks([task("tp-000001"), task("tp-000002", { parent: "tp-000001" })]);
    assert.equal(isReady(ix, ix.byId.get("tp-000001")!, noLeases()), false);
  });

  test("条件 1：子任务全部关闭的容器**仍然**不 ready", () => {
    const ix = indexTasks([
      task("tp-000001"),
      task("tp-000002", { parent: "tp-000001", status: "closed", resolution: "done" }),
    ]);
    assert.equal(isReady(ix, ix.byId.get("tp-000001")!, noLeases()), false);
  });

  test("条件 2：被阻塞 → 不 ready", () => {
    const ix = indexTasks([task("tp-000001", { blocked_by: ["tp-000002"] }), task("tp-000002")]);
    assert.equal(isReady(ix, ix.byId.get("tp-000001")!, noLeases()), false);
  });

  test("条件 3：closed 不 ready", () => {
    const ix = indexTasks([task("tp-000001", { status: "closed", resolution: "done" })]);
    assert.equal(isReady(ix, ix.byId.get("tp-000001")!, noLeases()), false);
  });

  test("条件 3：in_progress 且 stale → ready（FR-C1「队列给出的一定能认领」的来源）", () => {
    const t = task("tp-000001", { status: "in_progress", assignee: "a", updated: iso(T0 - 3 * HOUR) });
    const ix = indexTasks([t]);
    assert.equal(isReady(ix, t, noLeases()), true);
  });

  test("条件 3：in_progress 但不 stale → 不 ready", () => {
    const t = task("tp-000001", { status: "in_progress", assignee: "a", updated: iso(T0 - HOUR) });
    const ix = indexTasks([t]);
    assert.equal(isReady(ix, t, noLeases()), false);
  });
});

// ---- spec §5.3.3 末句 / FR-D3：最近一次 done|closed 带 forced=true 则显示为未验证 ----

function closedWithLog(lines: string[]): TaskFile {
  return {
    path: "tasks/tp-000001.md", idFromFilename: "tp-000001",
    frontmatter: { id: "tp-000001", title: "T", status: "closed", resolution: "done",
      created: "2026-09-14T09:00:00Z", updated: "2026-09-14T12:00:00Z" },
    body: ["## Log", "", ...lines].join("\n"), raw: "",
  };
}

test("forced=true 的 done 使已关闭任务成为 unverified", () => {
  assert.equal(isUnverified(closedWithLog([
    '- 2026-09-14T11:02:00Z claude-code@mbp done forced=true: no time to run it',
  ])), true);
});

test("正常 done 不是 unverified", () => {
  assert.equal(isUnverified(closedWithLog([
    "- 2026-09-14T11:02:00Z claude-code@mbp done verify=pass commit=3f2a1c9",
  ])), false);
});

test("closed 动词同样算（spec 的动词是 closed，命令才叫 close）", () => {
  assert.equal(isUnverified(closedWithLog([
    "- 2026-09-14T11:02:00Z sean closed resolution=wontfix forced=true",
  ])), true);
});

test("看的是**最近**一次：更早 forced、最新未 forced → 不是 unverified", () => {
  // 这是这条规则的全部难点。取「有没有出现过 forced」会把这个例子判错。
  assert.equal(isUnverified(closedWithLog([
    "- 2026-09-14T10:00:00Z sean done forced=true: rushed",
    "- 2026-09-14T11:00:00Z sean reopened",
    "- 2026-09-14T12:00:00Z sean done verify=pass",
  ])), false);
});

test("反过来：更早正常、最新 forced → 是 unverified", () => {
  assert.equal(isUnverified(closedWithLog([
    "- 2026-09-14T10:00:00Z sean done verify=pass",
    "- 2026-09-14T11:00:00Z sean reopened",
    "- 2026-09-14T12:00:00Z sean done forced=true: rushed",
  ])), true);
});

test("非 done/closed 的动词不参与判断", () => {
  assert.equal(isUnverified(closedWithLog([
    "- 2026-09-14T10:00:00Z sean done verify=pass",
    "- 2026-09-14T11:00:00Z sean note forced=true",
  ])), false, "note 上的 forced=true 与完成态无关");
});

test("未关闭的任务永远不是 unverified", () => {
  // spec 的措辞是「A **closed** task whose most recent ...」。
  // 强制完成后又被重开的任务，不该继续挂着未验证的标记。
  const t = closedWithLog(['- 2026-09-14T11:02:00Z sean done forced=true: rushed']);
  t.frontmatter["status"] = "open";
  assert.equal(isUnverified(t), false);
});

test("没有 Log、或 Log 行坏掉时不算 unverified", () => {
  assert.equal(isUnverified(closedWithLog([])), false);
  assert.equal(isUnverified(closedWithLog(["- garbage line"])), false);
  assert.equal(isUnverified(closedWithLog([
    "- 2026-09-14T10:00:00Z sean done forced=true",
    "- not a log line at all",
  ])), true, "坏行被忽略，不影响前面那条有效的");
});

test("forced 不是 true 时不算（只有 forced=true 才算）", () => {
  assert.equal(isUnverified(closedWithLog([
    "- 2026-09-14T11:02:00Z sean done forced=false",
  ])), false);
});
