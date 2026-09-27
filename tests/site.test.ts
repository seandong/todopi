import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

test("原始 HTML 与危险链接：显示成文字、不执行；表格照样是表格；`___` 单元格不变成分隔线（F33 评审二轮）", () => {
  const src = mkdtempSync(join(tmpdir(), "todopi-site-src-"));
  mkdirSync(join(src, "fixtures", "valid"), { recursive: true });
  mkdirSync(join(src, "fixtures", "invalid"), { recursive: true });
  writeFileSync(join(src, "fixtures", "README.md"), "# Corpus\n");
  writeFileSync(join(src, "IMPLEMENTING.md"), "# Notes\n\n<div onclick=\"alert(3)\">block</div>\n");
  writeFileSync(join(src, "todopi-format-v1.md"), [
    "# Spec", "",
    "Inline <svg onload=alert(1)>x</svg> and [bad](javascript:alert(2)) and [ok](IMPLEMENTING.md).", "",
    "Pixels: ![pixel](https://evil.example/p1) ![](//evil.example/p2) ![js](javascript:alert(7)).", "",
    "<script>alert(4)</script>", "",
    "### 5.2 Frontmatter fields", "",
    "| # | Field | Note |", "|---|---|---|",
    "| 1 | `id` | <img src=x onerror=alert(5)> |",
    "| ___ | `t` | [x](javascript:alert(6)) |", "",
    "### 5.3 Body", "",
  ].join("\n"));
  const o = mkdtempSync(join(tmpdir(), "todopi-site-out-"));
  execFileSync(process.execPath, ["tools/site/build.mjs", o], { stdio: "ignore", env: { ...process.env, TODOPI_SITE_SPEC: src } });
  for (const f of ["index.html", "fields.html", "implementing.html"]) {
    const html = readFileSync(join(o, "spec", f), "utf8");
    // 没有任何可执行的东西：原始标签、事件属性、javascript: 链接
    assert.doesNotMatch(html, /<(svg|img|script|iframe)[\s>]/i, f);
    // 真标签上的事件属性（转义成文字的 `&lt;svg onload=` 不算）
    assert.doesNotMatch(html, /<[a-z][^>]*\son\w+=/i, f);
    assert.doesNotMatch(html, /href="javascript:/i, f);
    // 真标签上的 src（转义成文字的 `&lt;img src=` 不算）：页面不去任何地方取东西
    assert.doesNotMatch(html, /<[a-z][^>]*\ssrc=/i, f);
  }
  const index = readFileSync(join(o, "spec", "index.html"), "utf8");
  assert.match(index, /&lt;svg onload=alert\(1\)&gt;x&lt;\/svg&gt;/, "原文照样看得见");
  // Markdown 图片不生成 <img>（打开页面就会去外部取），变成普通链接
  assert.match(index, /<a href="https:\/\/evil.example\/p1">pixel<\/a>/);
  assert.match(index, /<a href="\/\/evil.example\/p2">\/\/evil.example\/p2<\/a>/);
  assert.match(index, /&lt;script&gt;alert\(4\)&lt;\/script&gt;/);
  assert.match(index, /<table><thead><tr><th>#<\/th><th>Field<\/th><th>Note<\/th><\/tr><\/thead>/, "表格仍是表格");
  assert.match(index, /<td>___<\/td>/, "___ 单元格保留原文");
  assert.match(index, /<td>&lt;img src=x onerror=alert\(5\)&gt;<\/td>/, "打头是 < 的单元格仍是行内文字，不变成 <pre>");
  assert.match(index, /href="implementing.html"/, "站内链接照样改写");
  assert.match(readFileSync(join(o, "spec", "implementing.html"), "utf8"), /&lt;div onclick=/);
});
