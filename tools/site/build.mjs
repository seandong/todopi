#!/usr/bin/env node
// tools/site/build.mjs —— 把 spec/ 生成可以直接部署的静态页（首发清单 §13：todopi.com/spec；F33）。
//
// 用法：node tools/site/build.mjs [输出目录]   默认 .site/（已在 .gitignore 里）
// 产出 <out>/spec/：规格全文（index.html）、12 字段表（fields.html）、实现者笔记（implementing.html）、语料库索引
// （fixtures/index.html）与每个语料一页，语料原文件（.md / .json）原样复制，实现者可以直接下载。
//
// 不引入新依赖：Markdown 用 CLI 本来就依赖的 commonmark。页面没有脚本、不加载任何外部资源（字体、CSS、统计都没有），
// 链接全是相对路径——直接用浏览器打开 file:// 就能预览，放到任何静态托管的 /spec 下都能用。部署见 docs/site.md。

import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as commonmark from "commonmark";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(process.argv[2] ?? join(repo, ".site"));
const spec = join(repo, "spec");
const site = join(out, "spec");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** 标题的锚点：GitHub 的规则（小写、去标点、空格变 -），GitHub 上看源文件时的锚点与站点一致 */
const slug = (text) => text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");

/** 规格里指向仓库文件的链接，在站点里指向对应的页 */
const LINKS = { "IMPLEMENTING.md": "implementing.html", "fixtures/README.md": "fixtures/index.html" };

/** 一个表格单元格里的行内 Markdown → HTML（去掉包在外面的 <p>） */
function inline(text) {
  // commonmark.js 没有「只解析行内」的入口：单元格按块解析时，打头的 `#`、`-`、`>`、`1.` 这类记号会变成标题、列表、引用
  // （§5.2 表头那一格 `#` 曾变成一个空的 <h1>——Codex 评审）。把打头的块级记号转义掉，保证它按一段文字解析
  const safe = text.replace(/^([#>+*=-])/, "\\$1").replace(/^(\d+)([.)])/, "$1\\$2");
  return new commonmark.HtmlRenderer().render(new commonmark.Parser().parse(safe)).trim().replace(/^<p>([\s\S]*)<\/p>$/, "$1");
}

/** 按未转义的 | 切一行表格；\| 还原成 | */
const cellsOf = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
const DELIM = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/**
 * GFM 管道表格 → HTML 表格块。commonmark.js 只实现 CommonMark 本身，没有表格扩展，规格里的每张表（包括 12 字段表）原样渲染会变成
 * 一段文字。围栏代码块里的不动。生成的 HTML 没有空行，按 CommonMark 的 HTML 块规则整块原样输出。
 */
function gfmTables(md) {
  const lines = md.split("\n");
  const outLines = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) { if (fence === null) fence = f[1][0]; else if (f[1][0] === fence) fence = null; }
    if (fence === null && line.trim().startsWith("|") && i + 1 < lines.length && DELIM.test(lines[i + 1])) {
      const head = cellsOf(line);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) { rows.push(cellsOf(lines[j])); j++; }
      outLines.push("", "<table>", `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>`,
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody>`, "</table>", "");
      i = j - 1;
      continue;
    }
    outLines.push(line);
  }
  return outLines.join("\n");
}

/** Markdown → HTML：标题带锚点，站内链接改写；返回 HTML 与目录（二、三级标题） */
function render(markdown, { links = LINKS, base = "" } = {}) {
  const doc = new commonmark.Parser().parse(gfmTables(markdown));
  const toc = [];
  const used = new Set();
  const walker = doc.walker();
  for (let e = walker.next(); e; e = walker.next()) {
    const node = e.node;
    if (!e.entering) continue;
    if (node.type === "link" && node.destination in links) node.destination = base + links[node.destination];
    if (node.type === "heading") {
      let text = "";
      const w = node.walker();
      for (let t = w.next(); t; t = w.next()) if (t.entering && (t.node.type === "text" || t.node.type === "code")) text += t.node.literal;
      let id = slug(text);
      for (let n = 1; used.has(id); n++) id = `${slug(text)}-${n}`;
      used.add(id);
      // 锚点作为标题前的一个空 HTML 行内节点插进去
      const anchor = new commonmark.Node("html_inline");
      anchor.literal = `<a class="anchor" id="${esc(id)}" href="#${esc(id)}" aria-label="Link to this section">#</a>`;
      node.prependChild(anchor);
      if (node.level === 2 || node.level === 3) toc.push({ level: node.level, id, text });
    }
  }
  let html = new commonmark.HtmlRenderer({ safe: false }).render(doc);
  // 表格单元格里的链接是 gfmTables 单独渲染的、没经过上面的遍历：在成品上再改写一遍
  for (const [from, to] of Object.entries(links)) html = html.replaceAll(`href="${esc(from)}"`, `href="${esc(base + to)}"`);
  return { html, toc };
}

const CSS = `
:root { --fg: #1d1f21; --muted: #5b6168; --bg: #fdfdfc; --rule: #e3e3de; --code: #f3f3ef; --accent: #8a4b16; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6e6e3; --muted: #a0a4a8; --bg: #16181a; --rule: #2e3134; --code: #222528; --accent: #e0a25c; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
header, main, footer { max-width: 50rem; margin: 0 auto; padding: 0 1.25rem; }
header { padding-top: 1.5rem; border-bottom: 1px solid var(--rule); }
header nav { display: flex; flex-wrap: wrap; gap: .25rem 1.25rem; padding: .5rem 0 1rem; }
header .brand { font-weight: 650; color: var(--fg); text-decoration: none; }
a { color: var(--accent); }
nav a { text-decoration: none; }
nav a[aria-current] { color: var(--fg); font-weight: 600; }
h1, h2, h3, h4 { line-height: 1.25; margin: 2rem 0 .75rem; text-wrap: balance; }
h1 { font-size: 1.9rem; } h2 { font-size: 1.4rem; border-bottom: 1px solid var(--rule); padding-bottom: .3rem; } h3 { font-size: 1.15rem; }
.anchor { color: var(--muted); text-decoration: none; margin-left: -1.1em; width: 1.1em; display: inline-block; opacity: 0; }
h1:hover .anchor, h2:hover .anchor, h3:hover .anchor, h4:hover .anchor, .anchor:focus { opacity: 1; }
code, pre { font: .9em/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--code); border-radius: 4px; }
code { padding: .1em .3em; }
pre { padding: .8rem 1rem; overflow-x: auto; }
pre code { padding: 0; background: none; }
.table { overflow-x: auto; }
table { border-collapse: collapse; margin: 1rem 0; font-size: .93rem; }
th, td { border: 1px solid var(--rule); padding: .4rem .6rem; text-align: left; vertical-align: top; }
th { background: var(--code); }
.toc { font-size: .93rem; border: 1px solid var(--rule); border-radius: 6px; padding: .75rem 1rem; margin: 1.5rem 0; }
.toc ol { margin: 0; padding-left: 1.2rem; } .toc .l3 { margin-left: 1rem; font-size: .9em; }
.tag { font-size: .8rem; padding: .05rem .4rem; border-radius: 3px; border: 1px solid var(--rule); color: var(--muted); }
footer { color: var(--muted); font-size: .85rem; border-top: 1px solid var(--rule); margin-top: 3rem; padding: 1rem 1.25rem 2rem; }
`;

const PAGES = [
  ["index.html", "Specification"], ["fields.html", "Fields"], ["fixtures/index.html", "Test corpus"], ["implementing.html", "Implementing"],
];

/** 整页：导航（当前页标出来）、正文、页脚；up 是回到站点根（spec/）的相对前缀 */
function page({ path, title, body, toc = [] }) {
  const up = "../".repeat(path.split("/").length - 1);
  const nav = PAGES.map(([p, label]) => `<a href="${up}${p}"${p === path ? ' aria-current="page"' : ""}>${label}</a>`).join("\n");
  const tocHtml = toc.length === 0 ? "" : `<nav class="toc" aria-label="Contents"><ol>${toc.map((t) =>
    `<li class="l${t.level}"><a href="#${esc(t.id)}">${esc(t.text)}</a></li>`).join("")}</ol></nav>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — todopi format</title>
<style>${CSS}</style>
</head>
<body>
<header><a class="brand" href="${up}index.html">todopi format v1</a>
<nav aria-label="Site">${nav}</nav></header>
<main>
${tocHtml}
${body.replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, "</table></div>")}
</main>
<footer>Generated from <code>spec/</code> in the todopi repository. The Markdown source is normative; this page is a rendering of it.</footer>
</body>
</html>
`;
}

function write(rel, html) {
  const p = join(site, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, html);
}

rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });

// 规格全文
const specText = readFileSync(join(spec, "todopi-format-v1.md"), "utf8");
const full = render(specText);
write("index.html", page({ path: "index.html", title: "Specification", body: full.html, toc: full.toc }));

// 字段表：§5.2 那一节原样（表格与其后的说明），加一句指回全文
const start = specText.indexOf("### 5.2 ");
const end = specText.indexOf("\n### 5.3 ", start);
if (start < 0 || end < 0) throw new Error("spec: cannot find section 5.2 (the field table)");
const fields = render(`# Fields\n\nThe frontmatter of a task file, from [§5.2 of the specification](index.html#52-frontmatter-fields).\n\n${
  specText.slice(start, end).replace(/^### 5\.2 Frontmatter fields\n/, "")}`, { links: {} });
write("fields.html", page({ path: "fields.html", title: "Fields", body: fields.html }));

// 实现者笔记
const impl = render(readFileSync(join(spec, "IMPLEMENTING.md"), "utf8"));
write("implementing.html", page({ path: "implementing.html", title: "Implementing", body: impl.html, toc: impl.toc }));

// 语料库：README + 每个语料一行；每个语料一页，原文件原样复制
const readme = render(readFileSync(join(spec, "fixtures", "README.md"), "utf8"), { links: {} });
const rows = [];
for (const kind of ["valid", "invalid"]) {
  const dir = join(spec, "fixtures", kind);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md")).sort()) {
    const name = f.replace(/\.md$/, "");
    const md = readFileSync(join(dir, f), "utf8");
    const jsonText = readFileSync(join(dir, `${name}.json`), "utf8");
    const expect = JSON.parse(jsonText);
    const summary = kind === "valid" ? expect.note ?? "" : `${expect.violates ?? ""}: ${expect.reason ?? ""}`;
    mkdirSync(join(site, "fixtures", kind), { recursive: true });
    copyFileSync(join(dir, f), join(site, "fixtures", kind, f));
    copyFileSync(join(dir, `${name}.json`), join(site, "fixtures", kind, `${name}.json`));
    rows.push(`<tr><td><a href="${kind}/${esc(name)}.html">${esc(name)}</a></td><td><span class="tag">${kind}</span></td><td>${esc(summary)}</td></tr>`);
    write(`fixtures/${kind}/${name}.html`, page({
      path: `fixtures/${kind}/${name}.html`, title: `${name} (${kind})`,
      body: `<h1>${esc(name)} <span class="tag">${kind}</span></h1>
<p>${esc(summary)}</p>
<h2>${esc(f)}</h2>
<p><a href="${esc(f)}">Download</a></p>
<pre><code>${esc(md)}</code></pre>
<h2>${esc(name)}.json — ${kind === "valid" ? "what a conforming reader must produce" : "the violation a conforming reader must report"}</h2>
<p><a href="${esc(name)}.json">Download</a></p>
<pre><code>${esc(jsonText)}</code></pre>
<p><a href="../index.html">All fixtures</a></p>`,
    }));
  }
}
write("fixtures/index.html", page({
  path: "fixtures/index.html", title: "Test corpus",
  body: `${readme.html}<h2>All fixtures</h2><table><thead><tr><th>Fixture</th><th>Kind</th><th>What it checks</th></tr></thead><tbody>${rows.join("")}</tbody></table>`,
}));

console.log(`site written to ${join(out, "spec")} (${rows.length} fixtures); open ${join(out, "spec", "index.html")} to preview`);
