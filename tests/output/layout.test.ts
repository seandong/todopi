import { test } from "node:test";
import assert from "node:assert";
import { ANSI, PLAIN } from "../../src/output/style.ts";
import { action, diagnostic, next, shownPath, task, VERB_WIDTH } from "../../src/output/render/layout.ts";

/** Cargo 式记号（tp-rk6o8q）：PLAIN 下是同一份排版、没有转义；动词右对齐到第 12 列。 */
test("动作行：动词右对齐到第 12 列，空一格接对象；太长的动词不截断", () => {
  assert.equal(action(PLAIN, "Created", "a.txt"), "     Created a.txt");
  assert.equal(action(PLAIN, "Created", "a.txt").indexOf("a.txt"), VERB_WIDTH + 1);
  assert.equal(action(PLAIN, "Ready", ""), "       Ready");
  assert.equal(action(PLAIN, "Uninstallation", "x"), "Uninstallation x");
});

test("上色只加转义，去掉转义后与 PLAIN 逐字节相同", () => {
  const strip = (x: string) => x.replace(/\x1b\[[0-9;]*m/g, "");
  const cases: [string, string][] = [
    [action(ANSI, "Refused", "x", "fail"), action(PLAIN, "Refused", "x", "fail")],
    [task(ANSI, "tp-1", "T"), task(PLAIN, "tp-1", "T")],
    [diagnostic(ANSI, "warning", "w"), diagnostic(PLAIN, "warning", "w")],
    [next(ANSI, [["a", "b"], ["ccc", "d"]], true).join("\n"), next(PLAIN, [["a", "b"], ["ccc", "d"]], true).join("\n")],
  ];
  for (const [styled, plain] of cases) {
    assert.ok(styled.includes("\x1b"));
    assert.ok(!plain.includes("\x1b"));
    assert.equal(strip(styled), plain);
  }
});

test("Next：命令对齐；编号只在要求时出现", () => {
  assert.deepEqual(next(PLAIN, [["a", "first"], ["ccc", "second"]]), ["Next", "  a     first", "  ccc   second"]);
  assert.deepEqual(next(PLAIN, [["a", "first"], ["ccc", "second"]], true), ["Next", "  1. a     first", "  2. ccc   second"]);
});

test("家目录只在上色时缩成 ~；不是家目录下的路径原样", () => {
  assert.equal(shownPath(PLAIN, "/Users/me/x", "/Users/me"), "/Users/me/x");
  assert.equal(shownPath(ANSI, "/Users/me/x", "/Users/me"), "~/x");
  assert.equal(shownPath(ANSI, "/Users/meow/x", "/Users/me"), "/Users/meow/x");
});

test("setup：项目级给相对项目根的路径；用户级即使家目录在项目里也给绝对路径", async () => {
  const { renderSetup } = await import("../../src/output/render/setup.ts");
  const files = (p: string) => [{ path: p, status: "created" as const }];
  assert.equal(renderSetup({ agent: "codex", scope: "project", files: files("/p/.codex/hooks.json"), notes: [] }, { root: "/p" }),
    "     Created .codex/hooks.json\n");
  assert.equal(renderSetup({ agent: "pi", scope: "user", files: files("/p/h/.pi/x.ts"), notes: ["n"] }, { root: "/p" }),
    "     Created /p/h/.pi/x.ts\nnote: n\n");
  assert.equal(renderSetup({ agent: "pi", scope: "user", files: files("/p/h/.pi/x.ts"), notes: ["n"] }, { root: "/p", quiet: true }),
    "     Created /p/h/.pi/x.ts\n");
});

test("ls：表头与小结只给终端里的人（ANSI、MONO）；管道里（PLAIN）只有数据行，id 打头", async () => {
  const { renderText } = await import("../../src/output/render/ls.ts");
  const { MONO } = await import("../../src/output/style.ts");
  const t = (id: string, extra: Record<string, unknown> = {}) => ({
    id, title: `T ${id}`, status: "open", blocked_by: [], labels: [], created: "", updated: "",
    ready: true, blocked: false, stale: false, mine: false, unverified: false, ...extra,
  });
  const r = { tasks: [t("tp-a"), t("tp-bb", { status: "in_progress" })], total: 2, invalid: [] };
  assert.equal(renderText(r), "tp-a   ready        T tp-a\ntp-bb  in progress  T tp-bb\n");
  const human = renderText(r, { style: MONO });
  assert.match(human, /^ID +STATUS +TITLE\n/);
  assert.match(human, /\n\n2 tasks · 1 ready · 1 in progress\n$/);
  assert.equal(renderText(r, { style: MONO, quiet: true }), renderText(r), "--quiet 下也只有数据行");
  // 截断：管道里照旧在最后说 Showing（原来的行为），人看到的并进小结
  assert.match(renderText({ ...r, total: 5 }), /\n\nShowing 2 of 5 tasks\.\n$/);
  assert.match(renderText({ ...r, total: 5 }, { style: MONO }), /Showing 2 of 5 tasks · /);
});
