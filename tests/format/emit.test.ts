import { test } from "node:test";
import assert from "node:assert";
import { emitFrontmatter, emitTask, nextRank } from "../../src/format/emit.ts";
import { splitEnvelope } from "../../src/format/envelope.ts";
import { parseFrontmatter } from "../../src/format/frontmatter.ts";
import { scanCanonical } from "../../src/format/scan.ts";
import { readdirSync, readFileSync } from "node:fs";
import YAML from "yaml";
import { join } from "node:path";

const roundTrip = (fm: Record<string, unknown>) => {
  const text = emitFrontmatter(fm);
  const scanned = scanCanonical(text);
  assert.notEqual(scanned, null, `发射出的 frontmatter 必须走得通快路径：\n${text}`);
  return scanned;
};

test("键按 spec §5.2 的顺序发射", () => {
  const text = emitFrontmatter({
    updated: "2026-09-14T10:00:00Z", labels: ["auth"], id: "tp-a1b2c3",
    created: "2026-09-14T09:00:00Z", status: "open", title: "T",
  });
  const keys = text.split("\n").filter(Boolean).map((l) => l.slice(0, l.indexOf(":")));
  assert.deepEqual(keys, ["id", "title", "status", "labels", "created", "updated"]);
});

test.describe("对抗样例的写入方向 round-trip 无损", () => {
  const titles: Array<[string, string]> = [
    ["冒号", "feat: add login"],
    ["# 号", "fix #42 in the C# parser"],
    ["形似数字", "1.20"],
    ["YAML 关键字", "null"],
    ["尾随空格", "trailing spaces   "],
    ["双引号与反斜杠", 'He said "yes" then left C:\\path'],
    ["非 ASCII", "支持 passkey 登录 🥔"],
    ["形似 checkbox", "- [ ] not a checkbox"],
    ["YAML 元字符", "@at &anchor *star |pipe >gt %pct {a} [b] ,c"],
  ];
  for (const [name, title] of titles) {
    test(name, () => {
      const got = roundTrip({ id: "tp-a1b2c3", title, status: "open",
        created: "2026-09-14T09:00:00Z", updated: "2026-09-14T09:00:00Z" });
      assert.equal(got!["title"], title);
    });
  }
});

test("前导零的 rank 作为字符串保留", () => {
  const got = roundTrip({ id: "tp-a1b2c3", title: "T", status: "open", rank: "007",
    created: "2026-09-14T09:00:00Z", updated: "2026-09-14T09:00:00Z" });
  assert.equal(got!["rank"], "007");
});

test("列表用 flow 形式且元素加引号；空列表发射为 []", () => {
  const text = emitFrontmatter({ id: "tp-a1b2c3", title: "T", status: "open",
    blocked_by: [], labels: ["auth", "web"],
    created: "2026-09-14T09:00:00Z", updated: "2026-09-14T09:00:00Z" });
  assert.match(text, /^blocked_by: \[\]$/m);
  assert.match(text, /^labels: \["auth", "web"\]$/m);
});

test("undefined 的可选字段不被发射", () => {
  const text = emitFrontmatter({ id: "tp-a1b2c3", title: "T", status: "open",
    parent: undefined, verify: undefined,
    created: "2026-09-14T09:00:00Z", updated: "2026-09-14T09:00:00Z" });
  assert.doesNotMatch(text, /parent|verify/);
});

test("发射的整个任务文件能被 F01 的解析器读回", () => {
  const text = emitTask({
    id: "tp-a1b2c3", title: "feat: add login #42", status: "open", rank: "i0",
    created: "2026-09-14T09:00:00Z", updated: "2026-09-14T09:00:00Z",
    description: "Some description.",
    acceptance: ["first criterion", "second criterion"],
    log: ["2026-09-14T09:00:00Z sean created"],
  });
  const env = splitEnvelope(text);
  assert.ok(env, "必须是合法的信封");
  const parsed = parseFrontmatter(env!.head);
  assert.ok(parsed.ok);
  assert.equal(parsed.ok && parsed.data["title"], "feat: add login #42");
  assert.match(env!.body, /^## Description$/m);
  assert.match(env!.body, /^- \[ \] first criterion$/m);
  assert.match(env!.body, /^## Log$/m);
  assert.match(env!.body, /^- 2026-09-14T09:00:00Z sean created$/m);
});

test("没有可选正文小节时不发射空标题", () => {
  const text = emitTask({ id: "tp-a1b2c3", title: "T", status: "open", rank: "i0",
    created: "2026-09-14T09:00:00Z", updated: "2026-09-14T09:00:00Z", log: ["x"] });
  assert.doesNotMatch(text, /## Description/);
  assert.doesNotMatch(text, /## Acceptance Criteria/);
  assert.match(text, /## Log/);
});

test("nextRank 追加到末尾且字典序单调", () => {
  let last: string | null = null;
  const keys: string[] = [];
  for (let i = 0; i < 6; i++) { last = nextRank(last); keys.push(last); }
  assert.deepEqual(keys, [...keys].sort(), "连续分配的 rank 必须字典序单调");
  for (const k of keys) assert.match(k, /^[0-9a-z]{1,32}$/, "rank 必须匹配 spec §5.2");
});

test("嵌套值被完整写出，不是半个结构 —— 原先这里断言的是抛错", () => {
  // 这条用例原本钉的是「嵌套值必须被拒绝」，理由是「保留它们是 F10 edit 的事」。
  // 那个决定到 F05 作废了：claim 要改写既有文件，而带 external 的任务
  // 一改就抛错。现在钉的是相反的行为——写出去且读得回来。
  const fm = { id: "tp-a1b2c3", external: { linear: { id: "E-1" } } };
  const text = emitFrontmatter(fm);
  assert.doesNotMatch(text, /\[object Object\]/, "不得写出半个结构");
  const back = parseFrontmatter(text);
  assert.ok(back.ok, back.ok ? "" : back.error);
  assert.deepEqual(back.data["external"], fm.external);
});

// ---- 嵌套映射与整份语料的往返（F05 Task 1）----

test("嵌套映射能发射，并且读得回来（spec §5.2 字段 11 external）", () => {
  const fm = {
    id: "tp-a1b2c3",
    external: { linear: { id: "ENG-123", url: "https://linear.app/x/ENG-123" }, beads: { id: "b-7" } },
  };
  const back = parseFrontmatter(emitFrontmatter(fm));
  assert.ok(back.ok, back.ok ? "" : back.error);
  assert.deepEqual(back.data["external"], fm.external);
});

test("带嵌套映射时，其余键仍是规范形态 —— 快路径对它们继续有效", () => {
  // 整份都交给 yaml 会让 2000 个任务的解析从 16ms 退回 120ms（D006 实测）。
  // 只有那一个嵌套键走 yaml，别的标量照旧「每个都加引号」。
  const text = emitFrontmatter({ id: "tp-a1b2c3", title: "T", external: { a: { b: "c" } } });
  assert.match(text, /^id: "tp-a1b2c3"$/m);
  assert.match(text, /^title: "T"$/m);
});

test("全部 valid fixture 读进来再发射出去，语义不变", () => {
  // 按**键集合与取值**比较，不按 JSON 字符串——字段顺序会被规范化，
  // 那是 §5.1 要求的行为，不是缺陷。（第一次写这条用例时我按 JSON 比，
  // 得到一片「语义变了」的假警报。）
  const dir = join(import.meta.dirname, "..", "..", "spec", "fixtures", "valid");
  const files = readdirSync(dir).filter((x) => x.endsWith(".md"));
  assert.ok(files.length > 0, "语料库不该是空的");
  for (const f of files) {
    const env = splitEnvelope(readFileSync(join(dir, f), "utf8"));
    assert.ok(env !== null, `${f} 的信封切不开`);
    const first = parseFrontmatter(env.head);
    assert.ok(first.ok, `${f} 读不进来`);
    const second = parseFrontmatter(emitFrontmatter(first.data));
    assert.ok(second.ok, `${f} 重新发射后读不回来：${second.ok ? "" : second.error}`);
    const sorted = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort());
    assert.deepEqual(sorted(second.data), sorted(first.data), `${f} 往返后语义变了`);
  }
});

// ---- 差分：自家解析器与标准 YAML 必须给出同一个结果（Codex 第三轮评审）----

test("发射出去的文件，scan 快路径与标准 YAML 解析必须一致", () => {
  // 第一版 plainKey 按**字符形状**判断，于是 `null:` / `True:` / 1100 字符键
  // 都被手写拼出去了。它们在快路径下是字面字符串键，在 yaml 下却分别变成
  // 空字符串、布尔 true、解析失败——**同一个文件在两条路径下含义不同**。
  // §5.1 要求读者把手写文件当合法 YAML 读，所以写出去的东西对两条路径
  // 必须是同一个意思。这条用例只测自家入口是抓不到的。
  const keys = [
    "null", "True", "False", "true", "yes", "on", "~", "#meta", "x-a: b",
    "x-中文", "- dash", "", "a".repeat(1100), "a".repeat(200), "x-ok_1.2-3",
  ];
  // 用深度严格比较而不是 JSON.stringify：后者把 Infinity / NaN 都写成 null，
  // 也分不出 -0 与 0——拿它当通用相等判据会留下盲区（Codex 第四轮评审）。
  const sorted = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort());
  for (const k of keys) {
    // 带嵌套值时整份会回退到 yaml 解析，差异只在那时显形——两种都要测
    for (const extra of [{}, { external: { linear: { id: "E-1" } } }]) {
      const fm: Record<string, unknown> = { id: "tp-a1b2c3", [k]: "keep", ...extra };
      const text = emitFrontmatter(fm);

      const mine = parseFrontmatter(text);
      assert.ok(mine.ok, `自家解析器读不回来（键 ${JSON.stringify(k)}）`);
      assert.deepStrictEqual(sorted(mine.data), sorted(fm), `自家解析器往返不一致（键 ${JSON.stringify(k)}）`);

      const std: unknown = YAML.parse(text);
      assert.ok(typeof std === "object" && std !== null, `标准 YAML 读不回来（键 ${JSON.stringify(k)}）`);
      assert.deepStrictEqual(sorted(std as Record<string, unknown>), sorted(fm),
        `标准 YAML 往返不一致（键 ${JSON.stringify(k)}）：${JSON.stringify(text.slice(0, 80))}`);
    }
  }
});

test("全部 valid fixture 重新发射后，两条解析路径仍然一致", () => {
  const dir = join(import.meta.dirname, "..", "..", "spec", "fixtures", "valid");
  const norm = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort());
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const env = splitEnvelope(readFileSync(join(dir, f), "utf8"));
    assert.ok(env !== null, f);
    const first = parseFrontmatter(env.head);
    assert.ok(first.ok, f);
    const text = emitFrontmatter(first.data);
    const std: unknown = YAML.parse(text);
    assert.ok(typeof std === "object" && std !== null, `${f} 标准 YAML 读不回来`);
    assert.deepStrictEqual(norm(std as Record<string, unknown>), norm(first.data), `${f} 标准 YAML 往返不一致`);
  }
});

test("非有限数值与 -0 等怪值也要原样往返", () => {
  // JSON.stringify 把 Infinity / NaN 都写成 null、分不出 -0 与 0，
  // 所以这些值要用深度严格比较单独验一遍（Codex 第四轮评审指出的盲区）。
  const cases: Array<Record<string, unknown>> = [
    { id: "tp-a1b2c3", "x-inf": Number.POSITIVE_INFINITY },
    { id: "tp-a1b2c3", "x-ninf": Number.NEGATIVE_INFINITY },
    { id: "tp-a1b2c3", "x-nan": Number.NaN },
    { id: "tp-a1b2c3", "x-negzero": -0 },
    { id: "tp-a1b2c3", "x-zero": 0 },
    { id: "tp-a1b2c3", "x-big": Number.MAX_SAFE_INTEGER },
  ];
  for (const fm of cases) {
    const text = emitFrontmatter(fm);
    const mine = parseFrontmatter(text);
    assert.ok(mine.ok, `${JSON.stringify(Object.keys(fm)[1])} 自家解析器读不回来`);
    assert.deepStrictEqual(mine.data, fm, `${JSON.stringify(Object.keys(fm)[1])} 自家往返不一致`);
    const std: unknown = YAML.parse(text);
    assert.deepStrictEqual(std, fm, `${JSON.stringify(Object.keys(fm)[1])} 标准 YAML 往返不一致`);
  }
});

test("多个特殊键共存时互不干扰", () => {
  const fm: Record<string, unknown> = {
    id: "tp-a1b2c3", title: "T",
    "null": "a", "True": "b", "#c": "c", "x-a: b": "d", "x-ok": "e",
    external: { linear: { id: "E-1" } },
  };
  const text = emitFrontmatter(fm);
  const sorted = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort());
  assert.deepStrictEqual(sorted(YAML.parse(text) as Record<string, unknown>), sorted(fm));
  const mine = parseFrontmatter(text);
  assert.ok(mine.ok);
  assert.deepStrictEqual(sorted(mine.data), sorted(fm));
});
