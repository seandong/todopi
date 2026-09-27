import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * 规格站点（F33）：从 spec/ 生成，页面齐全、12 字段表完整、每个语料有页且原文件可下载、站内链接与锚点都能到、不加载任何外部资源。
 */
const out = mkdtempSync(join(tmpdir(), "todopi-site-"));
execFileSync(process.execPath, ["tools/site/build.mjs", out], { stdio: "ignore" });
const site = join(out, "spec");

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".html")).map((f) => join(dir, f));
}
const pages = htmlFiles(site);
const text = (p: string) => readFileSync(p, "utf8");

test("页面齐全：规格、字段、实现者笔记、语料库索引", () => {
  for (const p of ["index.html", "fields.html", "implementing.html", "fixtures/index.html"]) assert.ok(existsSync(join(site, p)), p);
});

test("字段页是 §5.2 的 12 个字段（表格真的渲染成了表格）", () => {
  const html = text(join(site, "fields.html"));
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  const rows = body.split("<tr>").length - 1;
  assert.equal(rows, 12);
  // 表头逐格与规格一致（第一格是 `#`：曾被当成一级标题渲染成空的 <h1>）
  const head = [...(/<thead>([\s\S]*?)<\/thead>/.exec(html)?.[1] ?? "").matchAll(/<th>([\s\S]*?)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(head, ["#", "Field", "Type", "Required", "Constraints"]);
  for (const f of ["id", "title", "status", "resolution", "assignee", "parent", "blocked_by", "rank", "verify", "labels", "external", "created"]) {
    assert.ok(body.includes(`<code>${f}</code>`), f);
  }
  // 任何表格单元格里都不该出现块级元素（标题、列表、引用）——单元格是行内内容
  for (const p of pages) assert.doesNotMatch(text(p), /<t[hd]>\s*<(h\d|ul|ol|blockquote|p)>/, p);
  // 规格正文里不应留下没渲染的管道表格
  assert.doesNotMatch(text(join(site, "index.html")), /<p>\|/);
});

test("每个语料都有一页，原文件原样可下载", () => {
  for (const kind of ["valid", "invalid"]) {
    for (const f of readdirSync(join("spec", "fixtures", kind)).filter((x) => x.endsWith(".md"))) {
      const name = f.replace(/\.md$/, "");
      assert.ok(existsSync(join(site, "fixtures", kind, `${name}.html`)), `${kind}/${name}.html`);
      assert.equal(readFileSync(join(site, "fixtures", kind, f), "utf8"), readFileSync(join("spec", "fixtures", kind, f), "utf8"));
      assert.ok(text(join(site, "fixtures", "index.html")).includes(`href="${kind}/${name}.html"`), `index lists ${kind}/${name}`);
    }
  }
});

test("站内链接与锚点都能到；外链只有普通 <a>，不加载任何外部资源、没有脚本", () => {
  const ids = new Map(pages.map((p) => [p, new Set([...text(p).matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!))]));
  const broken: string[] = [];
  for (const p of pages) {
    const html = text(p);
    assert.doesNotMatch(html, /<script|<link |<img |<iframe|@import|url\(/i, p);
    for (const [, href] of html.matchAll(/ href="([^"]+)"/g)) {
      if (/^https?:\/\//.test(href!)) continue;
      const [file, frag] = href!.split("#");
      const target = file === "" ? p : resolve(dirname(p), file!);
      if (!existsSync(target)) { broken.push(`${p} → ${href}`); continue; }
      if (frag && target.endsWith(".html") && !ids.get(target)?.has(frag)) broken.push(`${p} → ${href} (no anchor)`);
    }
  }
  assert.deepEqual(broken, []);
});
