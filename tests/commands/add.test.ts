import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  const cases: Array<[string, Parameters<typeof runAdd>[0], RegExp]> = [
    ["不合法的 label", { directory: "", title: "T", labels: ["BAD!"] }, /doctor|title/i],
    ["重复的 label", { directory: "", title: "T", labels: ["auth", "auth"] }, /doctor|title/i],
    ["多行标题（spec §5.2 要求单行）", { directory: "", title: "line one\nline two" }, /doctor|title/i],
    // actor 被拦在 FR-C4 的解析阶段——比写入前校验更早，连账本都没碰。
    // 报错信息因此指向 actor 与 spec §5.4，而不是 doctor。
    ["含空格的 actor（会让 Log 行解析错位）", { directory: "", title: "T", actor: "bad actor" }, /actor/i],
  ];
  for (const [name, opts, message] of cases) {
    test(name, () => {
      const d = repo();
      assert.throws(() => runAdd({ ...opts, directory: d }), message, name);
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

test("合法的父子关系照常建立", () => {
  const d = repo();
  const a = runAdd({ directory: d, title: "A" });
  const b = runAdd({ directory: d, title: "B", parent: a.id });
  assert.equal(runDoctor({ directory: d }).ok, true);
  assert.ok(b.id !== a.id);
});

test("账本原本就坏时，无关的 add 照常工作，doctor 仍报出既存问题", () => {
  // 判据是「这次写入**新引入**了什么问题」，不是「写完之后账本有没有问题」。
  // 按后者，一个与坏任务毫无关系的 add 也会被拒，用户除了手工修文件别无出路。
  // 复审指出我原来的写法丢弃了 path !== candidate.path 的图错误——那同样不对，
  // 因为一个环由多个文件共同构成，finding 可能挂在环上任何一个文件上。
  const d = repo();
  writeFileSync(join(d, ".todopi", "tasks", "tp-aaaaaa.md"), [
    '---', 'id: "tp-aaaaaa"', 'title: "self cycle"', 'status: "open"',
    'parent: "tp-aaaaaa"', 'rank: "i0"',
    'created: "2026-09-14T09:00:00Z"', 'updated: "2026-09-14T09:00:00Z"', '---',
    '', '## Log', '', '- 2026-09-14T09:00:00Z sean created', '',
  ].join("\n"));
  assert.equal(runDoctor({ directory: d }).ok, false, "前提：账本已经坏了");

  const t = runAdd({ directory: d, title: "unrelated" });
  assert.ok(t.id, "无关的 add 不该被既存问题拖累");

  const after = runDoctor({ directory: d });
  assert.equal(after.ok, false, "既存问题仍要被 doctor 报出来");
  assert.ok(after.findings.some((f) => f.path.includes("tp-aaaaaa")), "报的是那个坏任务");
  assert.ok(!after.findings.some((f) => f.path.includes(t.id)), "新任务本身是干净的");
});

test("--ac 带换行：拒绝，什么都不写（第九轮评审：换行后的 `## Plan` 把下一条标准挤出了门禁）", () => {
  const d = repo();
  assert.throws(() => runAdd({ directory: d, title: "T", acceptance: ["decoy\n\n## Plan\n", "real must pass"] }),
    (e: unknown) => e instanceof CliError && e.code === EXIT.usage && /single line/.test(e.message));
  assert.deepEqual(readdirSync(join(d, ".todopi", "tasks")), []);
});

test("描述会改变正文读法时拒绝；放进闭合围栏的照常允许（与 edit -d 同一个后置条件）", () => {
  const d = repo();
  for (const description of ["why\n\n## Acceptance Criteria\n\n- [x] decoy", "why\n\n```"]) {
    assert.throws(() => runAdd({ directory: d, title: "T", description, acceptance: ["real"] }),
      (e: unknown) => e instanceof CliError && e.code === EXIT.usage && /change how the task body is read/.test(e.message),
      JSON.stringify(description));
  }
  assert.deepEqual(readdirSync(join(d, ".todopi", "tasks")), []);
  runAdd({ directory: d, title: "T", description: "why\n\n```\n## Plan\n```", acceptance: ["real"] });
  assert.equal(runDoctor({ directory: d }).ok, true);
});
