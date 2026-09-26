import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { runEdit } from "../../src/commands/edit.ts";
import { runShow } from "../../src/commands/show.ts";
import { runDoctor } from "../../src/commands/doctor.ts";
import { EXIT, CliError } from "../../src/exit.ts";

const ME = "me@host";
const OTHER = "other@host";

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-edit-"));
  runInit({ directory: d, prefix: "tp" });
  return d;
}
const taskPath = (d: string, id: string) => join(d, ".todopi", "tasks", `${id}.md`);
const read = (d: string, id: string) => readFileSync(taskPath(d, id), "utf8");
const edit = (d: string, id: string, f: (s: string) => string) => writeFileSync(taskPath(d, id), f(read(d, id)));
const lastLog = (d: string, id: string) => read(d, id).trimEnd().split("\n").at(-1)!;
const code = (c: number) => (e: unknown) => e instanceof CliError && e.code === c;

test("改 title / verify / labels，记 edited fields=<排序后>，只列真的变了的", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "old", verify: "true", labels: ["keep", "drop"], actor: ME });
  const r = runEdit({ directory: d, id: t.id, title: "new", verify: "true", labels: ["-drop", "+add", "keep"], actor: ME });
  assert.deepEqual(r.fields, ["labels", "title"], "verify 没变，不该出现在 fields 里");
  const s = runShow({ directory: d, id: t.id });
  assert.equal(s.title, "new");
  assert.deepEqual(s.labels, ["keep", "add"]);
  assert.match(lastLog(d, t.id), /^- \S+Z me@host edited fields=labels,title$/);
  assert.equal(runDoctor({ directory: d }).ok, true);
});

test("什么都没变：退出 0，不写文件", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "same", actor: ME });
  const before = read(d, t.id);
  assert.equal(runEdit({ directory: d, id: t.id, title: "  same  ", actor: ME }).fields.length, 0);
  assert.equal(read(d, t.id), before);
});

test("一个选项都不给：退出 1", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  assert.throws(() => runEdit({ directory: d, id: t.id, actor: ME }), code(EXIT.usage));
});

test("title 的校验与 add 同一份：空的、超长的都拒绝", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME });
  assert.throws(() => runEdit({ directory: d, id: t.id, title: "   ", actor: ME }), code(EXIT.usage));
  assert.throws(() => runEdit({ directory: d, id: t.id, title: "x".repeat(201), actor: ME }),
    (e: unknown) => code(EXIT.usage)(e) && /200/.test((e as Error).message));
});

test("--verify \"\" 清掉字段，而不是写一个空串", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", verify: "make test", actor: ME });
  runEdit({ directory: d, id: t.id, verify: "", actor: ME });
  assert.doesNotMatch(read(d, t.id), /^verify:/m);
});

test("-d 改写 Description 小节；没有就新建，放在第一个小节之前；其余内容原样", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", description: "old why", acceptance: ["a"], actor: ME });
  edit(d, t.id, (s) => s.replace("## Log", "## Repair\n\nkeep me  \n\n## Log"));
  runEdit({ directory: d, id: t.id, description: "new why\n\nsecond paragraph", actor: ME });
  assert.equal(runShow({ directory: d, id: t.id }).description, "new why\n\nsecond paragraph");
  assert.ok(read(d, t.id).includes("## Repair\n\nkeep me  \n\n"), "未识别小节没有原样保留");
  assert.ok(!read(d, t.id).includes("old why"));

  const bare = runAdd({ directory: d, title: "U", acceptance: ["a"], actor: ME });
  edit(d, bare.id, (s) => s.replace(/^---\n\n/m, "---\nA preamble line.\n\n"));
  runEdit({ directory: d, id: bare.id, description: "added", actor: ME });
  const body = read(d, bare.id);
  assert.ok(body.indexOf("A preamble line.") < body.indexOf("## Description"), "首个标题前的段落被挤走了");
  assert.ok(body.indexOf("## Description") < body.indexOf("## Acceptance Criteria"), "Description 应在其他小节之前");
  assert.equal(runShow({ directory: d, id: bare.id }).description, "added");
});

test("--parent 设置与 none 清除；成环拒绝并给出路径；指向不存在的 id 拒绝", () => {
  const d = repo();
  const a = runAdd({ directory: d, title: "a", actor: ME }).id;
  const b = runAdd({ directory: d, title: "b", parent: a, actor: ME }).id;
  runEdit({ directory: d, id: b, parent: "none", actor: ME });
  assert.equal(runShow({ directory: d, id: b }).parent, undefined);
  runEdit({ directory: d, id: b, parent: a, actor: ME });
  assert.throws(() => runEdit({ directory: d, id: a, parent: b, actor: ME }),
    (e: unknown) => code(EXIT.usage)(e) && /cycle/.test((e as Error).message) && (e as Error).message.includes(a));
  assert.throws(() => runEdit({ directory: d, id: b, parent: "tp-zzzzzz", actor: ME }),
    (e: unknown) => code(EXIT.usage)(e) && /tp-zzzzzz/.test((e as Error).message));
});

test("已关闭任务：改 parent 拒绝（退出 2），改标题允许", () => {
  const d = repo();
  const a = runAdd({ directory: d, title: "a", actor: ME }).id;
  const t = runAdd({ directory: d, title: "typo", actor: ME }).id;
  edit(d, t, (s) => s.replace(/^status: "open"$/m, 'status: "closed"\nresolution: "done"'));
  assert.throws(() => runEdit({ directory: d, id: t, parent: a, actor: ME }), code(EXIT.gate));
  runEdit({ directory: d, id: t, title: "fixed", actor: ME });
  assert.equal(runShow({ directory: d, id: t }).title, "fixed");
});

test("别人持有时拒绝（FR-C6：edit 在写入严格匹配名单里）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME }).id;
  runClaim({ directory: d, id: t, actor: OTHER });
  assert.throws(() => runEdit({ directory: d, id: t, title: "x", actor: ME }), code(EXIT.conflict));
});

test("评审的门禁绕过反例：不带 --force 的 done 必须被验收门禁拒绝", async () => {
  const { runDone } = await import("../../src/commands/done.ts");
  const { GateRefused } = await import("../../src/commands/transition.ts");
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME }).id;
  edit(d, t, (s) => s.replace("## Log", [
    "## Plan", "", "  ```", "some code", "```", "",
    "## Acceptance Criteria", "", "- [ ] must run checks", "",
    "```", "example", "```", "", "## Log"].join("\n")));
  runClaim({ directory: d, id: t, actor: ME });
  assert.throws(() => runDone({ directory: d, id: t, actor: ME }), (e: unknown) => e instanceof GateRefused);
  assert.match(read(d, t), /^status: "in_progress"$/m, "任务不该被关闭");
});

test("正文里有没闭合的围栏：edit -d 拒绝，而不是猜着删东西", () => {
  // 读取端把没闭合的开头当普通文字（门禁必须看得见标准）；写入端不能据此去改写小节——
  // 评审实测「## Plan 下没闭合的 ```md 后面跟 ## Description」会让围栏里的代码被删掉。
  const d = repo();
  const t = runAdd({ directory: d, title: "T", actor: ME }).id;
  edit(d, t, (s) => s.replace("## Log", "## Plan\n\n```md\n## Description\nsecret\n\n## Log"));
  const before = read(d, t);
  assert.throws(() => runEdit({ directory: d, id: t, description: "x", actor: ME }),
    (e: unknown) => code(EXIT.usage)(e) && /never closed/.test((e as Error).message));
  assert.equal(read(d, t), before);
});

test("描述里一行顶格的 `## Acceptance Criteria`：拒绝，文件不动（第八轮评审：原有未勾标准曾被挤出门禁）", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "T", acceptance: ["real must pass"], actor: ME }).id;
  const before = read(d, t);
  for (const description of [
    "new\n\n## Acceptance Criteria\n\n- [x] decoy",
    "new\n\n<div>\n## Plan",                  // 被 <div> 吞掉、再被重解析出来的标题
    "new\n\n```",                              // 没闭合的围栏：此刻读法不变，但之后的每次写入都会被拒
  ]) {
    assert.throws(() => runEdit({ directory: d, id: t, description, actor: ME }),
      (e: unknown) => code(EXIT.usage)(e) && /change how the rest of the task body is read/.test((e as Error).message),
      JSON.stringify(description));
    assert.equal(read(d, t), before);
  }
  // 放进闭合的围栏或缩进四格：只是描述里的文字，允许。
  // 缩进 1–3 格的 `  ## Log` 不是小节边界（只有顶格的算），也照常允许。
  runEdit({ directory: d, id: t, description: "new\n\n```\n## Acceptance Criteria\n```\n\n    ## Log\n\n  ## Log", actor: ME });
  assert.deepEqual(runShow({ directory: d, id: t }).acceptance.map((c) => c.text), ["real must pass"]);
});
