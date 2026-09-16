import { test } from "node:test";
import assert from "node:assert";
import { validateGraph } from "../../src/domain/graph.ts";
import type { TaskFile } from "../../src/domain/types.ts";

function t(id: string, fm: Record<string, unknown> = {}): TaskFile {
  return {
    path: `tasks/${id}.md`, idFromFilename: id,
    frontmatter: { id, title: "T", status: "open", created: "2026-09-14T09:00:00Z", updated: "2026-09-14T09:00:00Z", ...fm },
    body: "", raw: "",
  };
}
const rules = (ts: TaskFile[]) => validateGraph(ts).map((f) => f.rule);

test("引用齐全时没有 finding", () => {
  assert.deepEqual(validateGraph([t("tp-000001"), t("tp-000002", { parent: "tp-000001" })]), []);
});

test("不变量 4：parent 指向不存在的任务", () => {
  assert.ok(rules([t("tp-000001", { parent: "tp-zzzzzz" })]).includes("invariant-4"));
});

test("不变量 4：blocked_by 指向不存在的任务", () => {
  assert.ok(rules([t("tp-000001", { blocked_by: ["tp-zzzzzz"] })]).includes("invariant-4"));
});

test("不变量 5：parent 指向自身（长度为 1 的环）", () => {
  assert.ok(rules([t("tp-000001", { parent: "tp-000001" })]).includes("invariant-5"));
});

test("不变量 5：长度为 3 的 parent 环", () => {
  const ts = [
    t("tp-000001", { parent: "tp-000002" }),
    t("tp-000002", { parent: "tp-000003" }),
    t("tp-000003", { parent: "tp-000001" }),
  ];
  assert.ok(rules(ts).includes("invariant-5"));
});

test("不变量 5：blocked_by 环", () => {
  const ts = [
    t("tp-000001", { blocked_by: ["tp-000002"] }),
    t("tp-000002", { blocked_by: ["tp-000001"] }),
  ];
  assert.ok(rules(ts).includes("invariant-5"));
});

test("环的 finding 里打印出环的路径", () => {
  const fs = validateGraph([t("tp-000001", { parent: "tp-000002" }), t("tp-000002", { parent: "tp-000001" })]);
  const cycle = fs.find((f) => f.rule === "invariant-5");
  assert.ok(cycle);
  assert.match(cycle.message, /tp-000001.*tp-000002|tp-000002.*tp-000001/);
});

test("菱形依赖不是环", () => {
  const ts = [
    t("tp-000001"), t("tp-000002", { blocked_by: ["tp-000001"] }),
    t("tp-000003", { blocked_by: ["tp-000001"] }),
    t("tp-000004", { blocked_by: ["tp-000002", "tp-000003"] }),
  ];
  assert.deepEqual(rules(ts).filter((r) => r === "invariant-5"), []);
});

test("同一个环只报一次", () => {
  const ts = [t("tp-000001", { parent: "tp-000002" }), t("tp-000002", { parent: "tp-000001" })];
  assert.equal(validateGraph(ts).filter((f) => f.rule === "invariant-5").length, 1);
});
