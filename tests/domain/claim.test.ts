import { test } from "node:test";
import assert from "node:assert";
import { decideClaim, type ClaimInput } from "../../src/domain/claim.ts";
import type { TaskFile } from "../../src/domain/types.ts";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-09-14T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

function task(fm: Record<string, unknown> = {}): TaskFile {
  return {
    path: "tasks/tp-000001.md", idFromFilename: "tp-000001",
    frontmatter: {
      id: "tp-000001", title: "T", status: "open",
      created: iso(NOW - 10 * HOUR), updated: iso(NOW - 10 * HOUR), ...fm,
    },
    body: "", raw: "",
  };
}

/** 默认：没有本机租约，租期 4 小时，我是 me@host。 */
function input(over: Partial<ClaimInput> = {}): ClaimInput {
  return {
    task: task(), actor: "me@host", steal: false,
    stale: { now: NOW, leaseHours: 4, heartbeatAt: () => null },
    ...over,
  };
}

test("open 的任务直接认领", () => {
  assert.deepEqual(decideClaim(input()), { kind: "claim" });
});

test("in_progress 且陈旧 → 无需 --steal 即可重新认领，记 steal=true", () => {
  // spec §6.1 写这一行的全部理由：§7.5 把陈旧的 in_progress 放进 ready 队列，
  // 一个把任务摆出来、claim 又拒绝它的组合会自相矛盾。
  const d = decideClaim(input({
    task: task({ status: "in_progress", assignee: "other@host", updated: iso(NOW - 5 * HOUR) }),
  }));
  assert.deepEqual(d, { kind: "reclaim", replaced: "other@host", stolen: true });
});

test("in_progress 且租约未过期、没给 --steal → 拒绝，退出 3", () => {
  const d = decideClaim(input({
    task: task({ status: "in_progress", assignee: "other@host", updated: iso(NOW - 1 * HOUR) }),
    stale: { now: NOW, leaseHours: 4, heartbeatAt: () => NOW - 1 * HOUR },
  }));
  assert.equal(d.kind, "refuse");
  assert.equal(d.kind === "refuse" ? d.code : null, 3, "FR-Q2：冲突是 3");
});

test("--steal 覆盖未过期的租约", () => {
  const d = decideClaim(input({
    task: task({ status: "in_progress", assignee: "other@host", updated: iso(NOW - 1 * HOUR) }),
    stale: { now: NOW, leaseHours: 4, heartbeatAt: () => NOW - 1 * HOUR },
    steal: true,
  }));
  assert.deepEqual(d, { kind: "reclaim", replaced: "other@host", stolen: true });
});

test("已经是我的任务 → 刷心跳，**不记 steal**", () => {
  // 没有替换任何人的 assignee，spec §5.3.3 的 steal=true 就不该出现。
  const d = decideClaim(input({
    task: task({ status: "in_progress", assignee: "me@host", updated: iso(NOW - 1 * HOUR) }),
    stale: { now: NOW, leaseHours: 4, heartbeatAt: () => NOW - 1 * HOUR },
  }));
  assert.deepEqual(d, { kind: "refresh" });
});

test("已经是我的任务，即使陈旧也是 refresh 而不是 steal", () => {
  const d = decideClaim(input({
    task: task({ status: "in_progress", assignee: "me@host", updated: iso(NOW - 9 * HOUR) }),
  }));
  assert.deepEqual(d, { kind: "refresh" });
});

test("closed 的任务不能认领 —— §6.1 没有这一行，属被拒绝的迁移，退出 2", () => {
  const d = decideClaim(input({ task: task({ status: "closed", resolution: "done" }) }));
  assert.equal(d.kind, "refuse");
  assert.equal(d.kind === "refuse" ? d.code : null, 2, "FR-Q2：门禁是 2");
});

test("closed 即使给了 --steal 也不能认领", () => {
  const d = decideClaim(input({ task: task({ status: "closed", resolution: "done" }), steal: true }));
  assert.equal(d.kind, "refuse");
});

test("replaced 取自任务文件的 assignee，不是租约里的 actor", () => {
  // 两者可能不一致：有人手改过任务文件，或租约是别的机器留下的。
  // spec §5.3.3 的 claimed 行说 text = the replaced actor，
  // 被替换的是任务文件里那个 assignee——那才是 committed 的事实。
  const d = decideClaim(input({
    task: task({ status: "in_progress", assignee: "in-file@host", updated: iso(NOW - 9 * HOUR) }),
    stale: { now: NOW, leaseHours: 4, heartbeatAt: () => null },
  }));
  assert.equal(d.kind === "reclaim" ? d.replaced : null, "in-file@host");
});

test("in_progress 却没有 assignee（不变量 3 被破坏）→ 拒绝，让 doctor 说话", () => {
  // 这时无从判断「替换了谁」。硬认领会写出一条 steal=true 而 text 为空的 Log 行。
  const d = decideClaim(input({ task: task({ status: "in_progress", updated: iso(NOW - 9 * HOUR) }) }));
  assert.equal(d.kind, "refuse");
  assert.match(d.kind === "refuse" ? d.message : "", /doctor/);
});

test("陈旧判定必须与 ls --ready 同源", () => {
  // 边界恰好等于 lease_hours 时不算过期（spec §7.3 用的是严格大于）。
  // 两处各判一次迟早会在这个边界上分叉，而那正是 ready 队列给出的任务
  // claim 不了的情形。
  const exactly = decideClaim(input({
    task: task({ status: "in_progress", assignee: "other@host", updated: iso(NOW - 4 * HOUR) }),
  }));
  assert.equal(exactly.kind, "refuse", "恰好等于租期不算过期");
  const justOver = decideClaim(input({
    task: task({ status: "in_progress", assignee: "other@host", updated: iso(NOW - 4 * HOUR - 1000) }),
  }));
  assert.equal(justOver.kind, "reclaim");
});

test("未知状态当作不可认领，而不是当成 open", () => {
  const d = decideClaim(input({ task: task({ status: "weird" }) }));
  assert.equal(d.kind, "refuse");
});
