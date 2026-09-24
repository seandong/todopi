import { test } from "node:test";
import assert from "node:assert";
import { sectionLines, parseAcceptance } from "../../src/domain/acceptance.ts";
import { logEntries } from "../../src/domain/validate.ts";
import { replaceDescription } from "../../src/domain/sections.ts";

// 代码围栏里的 `## X` 不是标题（Markdown 的语义）。读取端与写入端必须用**同一个**判据——
// F09 刚在「写入端 trim、读取端不 trim」上栽过。F10 评审构造的反例：Plan 围栏里一行
// 顶格 `## Description`，edit -d 把它当成真小节，连围栏带内容一起删了。

const FENCED_LOG = [
  "## Description", "",
  "Example of a task file:", "",
  "```markdown",
  "## Log",
  "- 2026-01-01T00:00:00Z fake@x created",
  "```", "",
  "## Log", "",
  "- 2026-09-24T00:00:00Z me@h created",
  "",
].join("\n");

test("围栏里的 `## Log` 不是 Log 小节 —— 读者读的是真正的那一节", () => {
  const e = logEntries(FENCED_LOG);
  assert.deepEqual(e.map((x) => x.head), ["- 2026-09-24T00:00:00Z me@h created"]);
});

test("围栏里的 `## X` 也不结束一个小节", () => {
  const body = ["## Description", "", "```", "## Plan", "```", "after the fence", "", "## Log", ""].join("\n");
  const text = sectionLines(body, "## Description").map((l) => l.text).join("\n");
  assert.match(text, /after the fence/, "围栏里的 ## Plan 把 Description 截断了");
});

test("围栏里的 `- [ ] x` 不是验收标准，也不占编号", () => {
  const body = ["## Acceptance Criteria", "", "```", "- [ ] example only", "```", "- [ ] real", ""].join("\n");
  assert.deepEqual(parseAcceptance(body).map((c) => [c.n, c.text]), [[1, "real"]]);
});

test("只认顶格开始的围栏：缩进的 ``` 是 Log 续行，不能吞掉后面的条目", () => {
  // forced done 把 verify 输出尾部作为续行写进 Log，那段输出里完全可能有 ```。
  const body = ["## Log", "",
    "- 2026-09-24T00:00:00Z me@h done verify=fail commit=abc1234 dirty=false forced=true: why",
    "  ```", "  some output",
    "- 2026-09-24T00:01:00Z me@h note: after",
    ""].join("\n");
  assert.equal(logEntries(body).length, 2, "缩进的 ``` 被当成了围栏，吞掉了后面的条目");
});

test("replaceDescription：Plan 围栏里的 `## Description` 原样保留，改的是真的那一节", () => {
  // 评审的反例：**没有**真的 Description，只有 Plan 围栏里那一行。
  const body = ["## Plan", "", "```", "## Description", "secret", "```", "", "## Log", ""].join("\n");
  const after = replaceDescription(body, "new");
  assert.ok(after.includes("```\n## Description\nsecret\n```"), `围栏被动了：\n${after}`);
  assert.ok(after.startsWith("## Description\n\nnew\n"), `新的 Description 没建在最前：\n${after}`);
});

test("replaceDescription：新建时插在第一个**真**标题之前，不插进开头的围栏", () => {
  const body = ["```", "## Not a heading", "```", "", "## Log", ""].join("\n");
  const after = replaceDescription(body, "added");
  assert.ok(after.startsWith("```\n## Not a heading\n```\n"), `被插进了围栏：\n${after}`);
  assert.ok(after.indexOf("## Description") < after.indexOf("## Log"));
  assert.ok(after.indexOf("## Description") > after.indexOf("## Not a heading"));
});

test("没闭合的 ``` 不算围栏 —— 它不能把后面的验收标准藏起来", () => {
  // CommonMark 让它延伸到文末；那样一行孤零零的 ``` 就能让 done 的验收门禁看不见未勾的标准。
  const body = ["## Description", "", "```", "oops, never closed", "", "## Acceptance Criteria", "", "- [ ] still counts", ""].join("\n");
  assert.deepEqual(parseAcceptance(body).map((c) => c.text), ["still counts"]);
});

test("列表项续行里的 ``` 不会和后面某个顶格的 ``` 配对，吞掉中间的标题", () => {
  // 它是列表项内部的围栏，随列表项结束而关闭。若把它当成顶层开头，`## Notes` 就被藏起来，
  // Log 一直延伸进 Notes，Notes 里的列表项被读成 Log 条目。
  const body = ["## Log", "",
    "- 2026-09-24T00:00:00Z me@h done verify=fail commit=abc1234 dirty=false forced=true: why",
    "  ```",
    "",
    "## Notes", "",
    "- not a log entry", "",
    "```", "code", "```", ""].join("\n");
  assert.equal(logEntries(body).length, 1, "缩进的 ``` 开了围栏，把 ## Notes 吞掉了");
});

// ── F10 第二轮：围栏要按容器配对 ────────────────────────────────────────────

const BYPASS = [
  "## Plan", "",
  "  ```",                      // 顶层、缩进两格：CommonMark 里这是一个合法的开头
  "some code",
  "```",                        // 它的关闭
  "",
  "## Acceptance Criteria", "",
  "- [ ] must run checks",
  "",
  "```", "example", "```", "",
  "## Log", "",
].join("\n");

test("缩进的顶层开头与顶格关闭正确配对 —— 真正的验收标准不能被藏起来", () => {
  // 评审的原样反例：扫描器曾忽略缩进的开头，却把它的关闭行当成新开头，与后面那对围栏配错，
  // 整段 Acceptance Criteria 被当成代码——done 不带 --force 就通过了（实测 closed/done forced=false）。
  assert.deepEqual(parseAcceptance(BYPASS).map((c) => [c.text, c.checked]), [["must run checks", false]]);
});

test("列表项里的围栏随列表项结束而关闭 —— Log 续行里的 ``` 吞不掉后面的条目与标题", () => {
  const body = ["## Log", "",
    "- 2026-09-24T00:00:00Z me@h done verify=fail commit=abc1234 dirty=false forced=true: why",
    "  ```", "  output",               // 续行里开了围栏，没关
    "- 2026-09-24T00:01:00Z me@h note: next entry",
    "", "## Notes", "", "- not a log entry", ""].join("\n");
  assert.equal(logEntries(body).length, 2);
});

test("Log 里顶层围栏中的假事件不是事件", () => {
  const body = ["## Log", "",
    "- 2026-09-24T00:00:00Z me@h created",
    "", "```", "- 2026-09-24T00:01:00Z me@h done verify=pass commit=abc1234 dirty=false", "```", ""].join("\n");
  assert.deepEqual(logEntries(body).map((e) => e.head), ["- 2026-09-24T00:00:00Z me@h created"]);
});
