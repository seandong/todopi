// spec/fixtures/ 是格式规格的可执行形式。本文件让它真的被实现执行。
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { splitEnvelope } from "../src/format/envelope.ts";
import { parseFrontmatter } from "../src/format/frontmatter.ts";
import { scanCanonical } from "../src/format/scan.ts";
import { validateFile } from "../src/domain/validate.ts";
import { validateGraph } from "../src/domain/graph.ts";
import type { TaskFile } from "../src/domain/types.ts";

const FX = join(import.meta.dirname, "..", "spec", "fixtures");
const mdFiles = (sub: string) => readdirSync(join(FX, sub)).filter((f) => f.endsWith(".md")).sort();
const meta = (sub: string, f: string) =>
  JSON.parse(readFileSync(join(FX, sub, f.replace(/\.md$/, ".json")), "utf8")) as Record<string, unknown>;

function taskOf(sub: string, f: string): TaskFile {
  const raw = readFileSync(join(FX, sub, f), "utf8");
  const env = splitEnvelope(raw);
  const id = f.replace(/\.md$/, "");
  if (!env) return { path: `${sub}/${f}`, idFromFilename: id, frontmatter: {}, body: "", raw, parseError: "信封不合法" };
  const p = parseFrontmatter(env.head);
  return p.ok
    ? { path: `${sub}/${f}`, idFromFilename: id, frontmatter: p.data, body: env.body, raw }
    : { path: `${sub}/${f}`, idFromFilename: id, frontmatter: {}, body: env.body, raw, parseError: p.error };
}

test.describe("valid/ —— 解析结果与期望值一致", () => {
  for (const f of mdFiles("valid")) {
    const m = meta("valid", f);
    if (!m["frontmatter"]) continue;
    test(f, () => {
      const t = taskOf("valid", f);
      assert.equal(t.parseError, undefined, `解析失败：${t.parseError}`);
      assert.deepEqual(t.frontmatter, m["frontmatter"]);
    });
  }
});

test.describe("valid/ —— 快路径与 yaml 路径结果一致（差分）", () => {
  for (const f of mdFiles("valid")) {
    test(f, () => {
      const raw = readFileSync(join(FX, "valid", f), "utf8");
      const env = splitEnvelope(raw);
      assert.ok(env);
      const scanned = scanCanonical(env.head);
      if (scanned === null) return;    // 这个样例测的是回退路径
      assert.deepEqual(scanned, parseYaml(env.head));
    });
  }
});

test.describe("valid/ —— doctor 认为它们干净", () => {
  for (const f of mdFiles("valid")) {
    const fm = meta("valid", f)["frontmatter"] as Record<string, unknown> | undefined;
    if (!fm || fm["id"] === undefined) continue;
    test(f, () => {
      const base = taskOf("valid", f);
      // 语料的文件名是描述性的（title-with-colon.md），不是 id。比对不变量 1 时
      // 用 frontmatter 里的 id 作为文件名，避免误报——语料测的是内容，不是命名。
      const t: TaskFile = { ...base, idFromFilename: String(base.frontmatter["id"]) };
      const findings = validateFile(t).filter((x) => x.rule !== "invariant-4");
      assert.deepEqual(findings, [], findings.map((x) => `${x.rule}: ${x.message}`).join("; "));
    });
  }
});

test.describe("invalid/ —— 各自被对应的规则抓到", () => {
  for (const f of mdFiles("invalid")) {
    const expected = String(meta("invalid", f)["violates"]);
    test(`${f} → ${expected}`, () => {
      const t = taskOf("invalid", f);
      const all = [...validateFile(t), ...validateGraph([t])];
      const found = all.map((x) => x.rule);
      assert.ok(found.length > 0, "应当报出至少一个问题");
      assert.ok(found.includes(expected as never), `期望 ${expected}，实际报出 ${found.join(", ")}`);
    });
  }
});
