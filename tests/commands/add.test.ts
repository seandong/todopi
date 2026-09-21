import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAdd } from "../../src/commands/add.ts";
import { runInit } from "../../src/commands/init.ts";
import { runDoctor } from "../../src/commands/doctor.ts";
import { renderText } from "../../src/output/render/add.ts";
import { EXIT, CliError } from "../../src/exit.ts";

function repo() {
  const d = mkdtempSync(join(tmpdir(), "todopi-add-"));
  runInit({ directory: d, prefix: "tp" });
  return d;
}

test("创建的任务通过 doctor", () => {
  const d = repo();
  runAdd({ directory: d, title: "feat: add login #42" });
  const r = runDoctor({ directory: d });
  assert.equal(r.ok, true, JSON.stringify(r.findings));
});

test("标题原样保留，含冒号与 # 号", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "feat: add login #42" });
  const text = readFileSync(join(d, ".todopi", "tasks", `${t.id}.md`), "utf8");
  assert.match(text, /^title: "feat: add login #42"$/m);
});

test("创建时分配 rank（FR-T1）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T" });
  const text = readFileSync(join(d, ".todopi", "tasks", `${t.id}.md`), "utf8");
  assert.match(text, /^rank: "[0-9a-z]{1,32}"$/m);
});

test("Log 只有一行 created", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: "sean" });
  const text = readFileSync(join(d, ".todopi", "tasks", `${t.id}.md`), "utf8");
  const logLines = text.split("## Log")[1]!.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(logLines.length, 1);
  assert.match(logLines[0]!, /^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z sean created$/);
});

test("--from 写成 created 的 from= 参数，不是单独字段", () => {
  const d = repo();
  const first = runAdd({ directory: d, title: "A", actor: "sean" });
  const second = runAdd({ directory: d, title: "B", actor: "sean", from: first.id });
  const text = readFileSync(join(d, ".todopi", "tasks", `${second.id}.md`), "utf8");
  assert.match(text, new RegExp(`created from=${first.id}$`, "m"));
  assert.doesNotMatch(text, /^discovered_from/m);
});

test("可选字段：描述、验收标准、标签、verify、parent、blocked-by", () => {
  const d = repo();
  const parent = runAdd({ directory: d, title: "P" });
  runAdd({
    directory: d, title: "T", description: "why it matters",
    acceptance: ["first", "second"], labels: ["auth", "web"],
    verify: "npm test", parent: parent.id, blockedBy: [parent.id],
  });
  const files = readdirSync(join(d, ".todopi", "tasks"));
  const child = files.find((f) => f !== `${parent.id}.md`)!;
  const text = readFileSync(join(d, ".todopi", "tasks", child), "utf8");
  assert.match(text, /^parent: "/m);
  assert.match(text, /^blocked_by: \["/m);
  assert.match(text, /^verify: "npm test"$/m);
  assert.match(text, /^labels: \["auth", "web"\]$/m);
  assert.match(text, /^## Description$/m);
  assert.match(text, /^- \[ \] first$/m);
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("空标题被拒绝，退出 1，且不留下文件", () => {
  const d = repo();
  assert.throws(
    () => runAdd({ directory: d, title: "   " }),
    (e: unknown) => e instanceof CliError && e.code === EXIT.usage,
  );
  assert.equal(runDoctor({ directory: d }).scanned, 0);
});

test("parent 或 blocked-by 指向不存在的任务时拒绝，且不留下文件", () => {
  const d = repo();
  for (const opts of [{ parent: "tp-zzzzzz" }, { blockedBy: ["tp-zzzzzz"] }]) {
    assert.throws(
      () => runAdd({ directory: d, title: "T", ...opts }),
      (e: unknown) => e instanceof CliError && e.code === EXIT.usage,
      JSON.stringify(opts),
    );
  }
  assert.equal(runDoctor({ directory: d }).scanned, 0, "被拒绝的 add 不得留下文件");
});

test("没有 .todopi/ 时退出 1 并提示先 init", () => {
  const d = mkdtempSync(join(tmpdir(), "todopi-noledger-"));
  assert.throws(
    () => runAdd({ directory: d, title: "T" }),
    (e: unknown) => e instanceof CliError && e.code === EXIT.usage,
  );
});

test("输出是英文且 --quiet 去掉提示", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T" });
  assert.doesNotMatch(renderText(t), /[一-鿿]/, "CLI 输出 MUST 是英文");
  assert.match(renderText(t), new RegExp(t.id));
  assert.match(renderText(t, { quiet: true }), new RegExp(t.id), "结果不得被 quiet 吞掉");
});

test.describe("写不出通过 doctor 的文件时拒绝，且零残留", () => {
  // FR-T1 的验收是「文件存在、**通过 doctor**」。一条写出了 doctor 不通过的文件
  // 却退出 0 的命令，是在把问题推给下一个人。校验必须在写入之前。
  const cases: Array<[string, Parameters<typeof runAdd>[0]]> = [
    ["不合法的 label", { directory: "", title: "T", labels: ["BAD!"] }],
    ["重复的 label", { directory: "", title: "T", labels: ["auth", "auth"] }],
    ["多行标题（spec §5.2 要求单行）", { directory: "", title: "line one\nline two" }],
    ["含空格的 actor（会让 Log 行解析错位）", { directory: "", title: "T", actor: "bad actor" }],
  ];
  for (const [name, opts] of cases) {
    test(name, () => {
      const d = repo();
      assert.throws(() => runAdd({ ...opts, directory: d }), /doctor|title/i, name);
      assert.equal(runDoctor({ directory: d }).scanned, 0, "被拒绝的 add 不得留下文件");
    });
  }
});

test("拒绝之后账本仍然干净，后续的合法 add 照常工作", () => {
  const d = repo();
  assert.throws(() => runAdd({ directory: d, title: "T", labels: ["BAD!"] }));
  const t = runAdd({ directory: d, title: "feat: ok #1", labels: ["auth"] });
  assert.equal(runDoctor({ directory: d }).ok, true);
  assert.equal(runDoctor({ directory: d }).scanned, 1);
  assert.ok(t.id);
});
