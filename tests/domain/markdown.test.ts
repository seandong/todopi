import { test } from "node:test";
import assert from "node:assert";
import { sectionLines, parseAcceptance } from "../../src/domain/acceptance.ts";
import { logEntries } from "../../src/domain/validate.ts";
import { replaceDescription } from "../../src/domain/sections.ts";
import { structure } from "../../src/markdown/sections.ts";

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

// ── F10 第三轮之后：交给 CommonMark 参考实现（D031）─────────────────────────

test("行首 Tab 是四格缩进：`\\t```` 是缩进代码块，不是围栏开头（评审第三轮的门禁绕过）", () => {
  const body = ["## Plan", "", "\t```", "", "## Acceptance Criteria", "", "- [ ] must run checks", "",
    "```", "example", "```", "", "## Log", ""].join("\n");
  assert.deepEqual(parseAcceptance(body).map((c) => c.text), ["must run checks"]);
});

test("HTML <pre> 块里的 ``` 不是围栏（手写近似时我自己推出来的第四种绕法）", () => {
  const body = ["## Plan", "", "<pre>", "```", "</pre>", "", "## Acceptance Criteria", "", "- [ ] must run checks", "",
    "```", "x", "```", ""].join("\n");
  assert.deepEqual(parseAcceptance(body).map((c) => c.text), ["must run checks"]);
});

test("对抗性正文：各种结构之后的一条顶层未勾标准，永远被认出来", () => {
  const prefixes: string[][] = [
    ["\t```"], ["  ```", "x", "```"], ["   ~~~", "x", "~~~"], ["    ```", "x"],
    ["<pre>", "```", "</pre>"], ["<div>", "```", "</div>"], ["> ```", "> x"], ["> ```"],
    ["- item", "  ```", "  x"], ["1. item", "   ```"], ["-\t```"], ["```js `x`", "y"],
    ["````", "```", "````"], ["~~~", "```", "~~~"], ["<!--", "```", "-->"], ["```", "## Acceptance Criteria", "- [x] fake", "```"],
    ["* a", "  * b", "    ```"], ["- [x] done", "  ```", "  - [ ] nested in code"], ["\\```", "x"], ["`` ``` ``"],
    ["<pre>"], ["<script>"], ["<!--"], ["<?x"], ["<!DOCTYPE"], ["<![CDATA["], ["<STYLE type=x>"], ["  <textarea"],
  ];
  for (const pre of prefixes) {
    const body = ["## Plan", "", ...pre, "", "## Acceptance Criteria", "", "- [ ] must run checks", "",
      "```", "trailing", "```", "", "## Log", ""].join("\n");
    const got = parseAcceptance(body).filter((c) => !c.checked).map((c) => c.text);
    assert.ok(got.includes("must run checks"), `这段前缀之后的未勾标准没被认出来：${JSON.stringify(pre)}\n→ ${JSON.stringify(got)}`);
  }
});

test("没闭合的 <pre>、<!-- 等（CommonMark 第 1–5 类 HTML 块）同样藏不住后面的标准（第四轮）", () => {
  // 这几类 HTML 块只在各自的结束标记处结束，没有就延伸到文末——和没闭合的 ``` 是同一个口子。
  for (const opener of ["<pre>", "<script>", "<style>", "<textarea>", "<!-- x", "<?php", "<!DOCTYPE html", "<![CDATA["]) {
    const lines = ["## Plan", "", opener, "", "## Acceptance Criteria", "", "- [ ] must run checks", ""];
    assert.deepEqual(parseAcceptance(lines.join("\n")).map((c) => c.text), ["must run checks"], opener);
    assert.equal(structure(lines).reparsedAt, 2, `${opener} 应当记为没闭合`);
  }
});

test("闭合了的 HTML 块照 CommonMark 处理：里面的假标准不算，也不记为没闭合", () => {
  // 包括结束标记与开头在同一行的——`<!-->` 在 commonmark 0.31 里就是一个完整的注释。
  for (const block of [["<pre>", "- [ ] fake", "</pre>"], ["<!-- c -->"], ["<!-->"], ["<!--", "- [ ] fake", "-->"], ["<?x ?>"]]) {
    const lines = ["## Acceptance Criteria", "", ...block, "", "- [ ] real", ""];
    assert.deepEqual(parseAcceptance(lines.join("\n")).map((c) => c.text), ["real"], JSON.stringify(block));
    assert.equal(structure(lines).reparsedAt, -1, JSON.stringify(block));
  }
});

test("第 6、7 类（<div>、任意标签）在空行处结束：隔了空行不算没闭合，里面的普通文字照样是 HTML", () => {
  assert.equal(structure(["<div>", "", "## Log", ""]).reparsedAt, -1);
  assert.equal(structure(["<div>", "just text", "</div>", "", "## Log", ""]).reparsedAt, -1);
  assert.equal(structure(["<custom>", "text", "", "- [ ] x"]).reparsedAt, -1);
});

test("第 6、7 类紧贴着一个会开始块的行：吞掉了它，当没闭合处理（第五轮评审）", () => {
  // 标题前、标准前、两者都紧贴——三种都要看得见。
  for (const body of [
    ["## Plan", "<div>", "## Acceptance Criteria", "- [ ] must check"],
    ["## Acceptance Criteria", "<div>", "- [ ] must check"],
    ["## Acceptance Criteria", "<table>", "<tr>", "- [ ] must check"],
    ["## Plan", "<custom>", "## Acceptance Criteria", "- [ ] must check"],
    ["## Plan", "</pre>", "## Acceptance Criteria", "- [ ] must check"],
  ]) assert.deepEqual(parseAcceptance(body.join("\n")).map((c) => c.text), ["must check"], JSON.stringify(body));
  // 后果：`<div>` 里一行 `## inside` 成了真的小节边界。这是有意的——判据是「作者没写结束标记」，
  // 不是「看起来像示例」。
  const st = structure(["<div>", "## inside", "</div>"]);
  assert.equal(st.reparsedAt, 0);
  assert.ok(st.h2.has(1));
});

test("暴力枚举：一条标准之后没有任何结束标记时，它前面无论是什么，它都看得见", () => {
  // 独立于实现的判据：藏住一行的唯一合法方式是它后面有作者写下的结束标记（```、~~~、</pre>、--> 之类）。
  // 目标标准是正文最后一行，后面什么都没有；标题与它之间也没有能关闭前缀里的块的行——所以它必须被认出来。前缀与夹在中间的行取自下面的字母表，
  // 覆盖三类会吞行的块、容器、缩进、段落与 setext。
  const ALPHA = ["<div>", "<pre>", "</pre>", "<!--", "-->", "```", "~~~", "\t```", "> x", "- x", "  x", "x", "",
    "<table>", "<custom>", "</div>", "    code", "---", "<?x"];
  const seqs = (n: number): string[][] => n === 0 ? [[]] : seqs(n - 1).flatMap((s) => ALPHA.map((a) => [...s, a]));
  let count = 0;
  for (let total = 0; total <= 3; total++) {
    for (const seq of seqs(total)) {
      for (let cut = 0; cut <= total; cut++) {
        const [pre, mid] = [seq.slice(0, cut), seq.slice(cut)];
        // 标题与目标之间若有一行能关闭前缀里打开的块，标题本身就被作者合法地包住了——那不在判据之内。
        const closes = (a: string) => (["```", "~~~"].includes(a) && pre.includes(a))
          || (a === "</pre>" && pre.includes("<pre>")) || (a === "-->" && pre.includes("<!--"));
        if (mid.some(closes)) continue;
        const body = [...pre, "## Acceptance Criteria", ...mid, "- [ ] target"].join("\n");
        const got = parseAcceptance(body).filter((c) => c.text === "target" && !c.checked);
        assert.equal(got.length, 1, `标准被藏起来了：${JSON.stringify(body)}`);
        count++;
      }
    }
  }
  assert.ok(count > 25000, `枚举规模：${count}`);
});

test("验收标准小节重复出现：全部读，编号跨小节连续 —— 重复的标题藏不住标准（spec §5.3）", () => {
  const body = ["## Acceptance Criteria", "", "- [x] decoy", "", "## Plan", "", "p", "",
    "## Acceptance Criteria", "", "- [ ] real must pass", ""].join("\n");
  assert.deepEqual(parseAcceptance(body).map((c) => [c.n, c.text, c.checked]), [[1, "decoy", true], [2, "real must pass", false]]);
});
