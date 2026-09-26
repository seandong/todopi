// src/output/render/board-page.ts
// FR-B2 的看板页面：一页 HTML，样式与脚本全部内联，不引用任何外部资源（ARCH-001；服务端还加了 CSP）。
//
// 只读（FR-B3）：页面里没有表单、没有写操作的按钮，数据只从 SSE 来（`/events`，每条消息是一份完整的 BoardDto）。
// 任务内容一律经 textContent 进 DOM，不拼 HTML——标题、Log 都是账本里任何人能写的文字。
// 页面上的文案是英文（面向用户的界面）。

export const BOARD_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>todopi board</title>
<style>
:root {
  --ground: #f4f6f9; --surface: #ffffff; --raised: #fbfcfd; --ink: #18202c; --muted: #5a6475; --line: #dde2ea;
  --accent: #2c64d6; --accent-soft: #e6eefc;
  --c-open: #5a6475; --c-blocked: #a3620a; --c-progress: #2c64d6; --c-done: #23804f; --c-closed: #8a93a3;
  --warn: #a3620a; --warn-soft: #fbf1e1; --bad: #b4232c; --bad-soft: #fbe9ea; --good: #23804f; --good-soft: #e5f4ec;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ground: #11151b; --surface: #181d25; --raised: #1d232c; --ink: #e4e8ee; --muted: #98a2b3; --line: #2a313c;
    --accent: #7ea6ff; --accent-soft: #1d2a45;
    --c-open: #98a2b3; --c-blocked: #e0a24a; --c-progress: #7ea6ff; --c-done: #5cc68d; --c-closed: #6f7888;
    --warn: #e0a24a; --warn-soft: #3a2c16; --bad: #f07a80; --bad-soft: #3d1e21; --good: #5cc68d; --good-soft: #17332a;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--ground); color: var(--ink); font: 14px/1.45 var(--sans); }
button { font: inherit; color: inherit; }
button:focus-visible, .card:focus-visible, .row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; padding: 14px 20px;
  background: var(--surface); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 2; }
.brand { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.brand b { font-size: 15px; letter-spacing: .01em; }
.brand span { color: var(--muted); font-family: var(--mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
nav { display: flex; gap: 4px; background: var(--ground); border: 1px solid var(--line); border-radius: 8px; padding: 3px; }
nav button { border: 0; background: none; padding: 5px 12px; border-radius: 6px; cursor: pointer; color: var(--muted); }
nav button[aria-current="page"] { background: var(--surface); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.live { margin-left: auto; display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
.live i { width: 8px; height: 8px; border-radius: 50%; background: var(--c-closed); }
.live.on i { background: var(--good); }
.live.off i { background: var(--bad); }
.notice { margin: 12px 20px 0; padding: 10px 12px; border-radius: 8px; background: var(--warn-soft); color: var(--warn); font-size: 13px; }
.notice[hidden] { display: none; }
main { padding: 16px 20px 40px; }
.columns { display: grid; grid-template-columns: repeat(5, minmax(220px, 1fr)); gap: 14px; overflow-x: auto; align-items: start; }
.col h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.col h2 i { width: 8px; height: 8px; border-radius: 2px; background: var(--dot); }
.col h2 em { font-style: normal; font-variant-numeric: tabular-nums; margin-left: auto; }
.stack { display: flex; flex-direction: column; gap: 8px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; cursor: pointer; text-align: left; width: 100%; }
.card:hover { border-color: var(--accent); }
.card .id, .row .id { font-family: var(--mono); font-size: 11.5px; color: var(--muted); }
.card .title { margin: 3px 0 0; overflow-wrap: anywhere; }
.chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.chip { font-size: 11px; line-height: 18px; padding: 0 7px; border-radius: 9px; background: var(--ground); color: var(--muted); border: 1px solid var(--line); white-space: nowrap; }
.chip.mine { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.chip.warn { background: var(--warn-soft); color: var(--warn); border-color: transparent; }
.chip.bad { background: var(--bad-soft); color: var(--bad); border-color: transparent; }
.chip.good { background: var(--good-soft); color: var(--good); border-color: transparent; }
.empty { color: var(--muted); font-size: 13px; padding: 6px 2px; }
.tree, .ready { max-width: 860px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 6px; }
.row { display: flex; align-items: baseline; gap: 10px; padding: 7px 10px; border-radius: 6px; cursor: pointer; border: 0; background: none; width: 100%; text-align: left; }
.row:hover { background: var(--ground); }
.row .title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.row .dot { width: 8px; height: 8px; border-radius: 2px; background: var(--dot); flex: none; align-self: center; }
.row .n { font-family: var(--mono); font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; min-width: 2.5em; text-align: right; }
.row.closed .title { color: var(--muted); }
.kids { margin-left: 18px; border-left: 1px solid var(--line); padding-left: 6px; }
.drawer { position: fixed; inset: 0 0 0 auto; width: min(560px, 100%); background: var(--surface); border-left: 1px solid var(--line);
  box-shadow: -12px 0 32px rgba(0,0,0,.12); overflow-y: auto; z-index: 3; padding: 18px 22px 40px; }
.drawer[hidden] { display: none; }
.drawer .close { float: right; border: 1px solid var(--line); background: var(--raised); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
.drawer h1 { font-size: 18px; line-height: 1.3; margin: 8px 0 10px; text-wrap: balance; overflow-wrap: anywhere; }
.drawer h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 22px 0 8px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 0; font-size: 13px; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }
.mono { font-family: var(--mono); font-size: 12.5px; }
.link { color: var(--accent); cursor: pointer; background: none; border: 0; padding: 0; font-family: var(--mono); font-size: 12.5px; }
.prose { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
.criteria { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.criteria li { display: grid; grid-template-columns: 1.4em 1.8em 1fr; gap: 2px; overflow-wrap: anywhere; }
.criteria .box { color: var(--muted); }
.criteria .done .box { color: var(--good); }
.criteria .num { color: var(--muted); font-family: var(--mono); font-size: 12px; padding-top: 1px; }
.note { color: var(--muted); white-space: pre-wrap; font-size: 13px; margin: 2px 0 2px 3.2em; }
.entries { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
.entries li { border-left: 2px solid var(--line); padding-left: 10px; }
.entries .when { font-family: var(--mono); font-size: 11.5px; color: var(--muted); }
.entries .verb { font-weight: 600; }
.entries .args { font-family: var(--mono); font-size: 12px; color: var(--muted); }
.entries .text { white-space: pre-wrap; overflow-wrap: anywhere; }
.entries pre { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.4 var(--mono); background: var(--ground); padding: 6px 8px; border-radius: 6px; }
.evidence li.pass { border-left-color: var(--good); }
.evidence li.fail { border-left-color: var(--bad); }
@media (max-width: 720px) {
  header { padding: 12px 16px; }
  main { padding: 14px 16px 40px; }
  .notice { margin: 12px 16px 0; }
  .columns { grid-template-columns: repeat(5, 78vw); }
}
@media (prefers-reduced-motion: no-preference) { .card, .row { transition: border-color .12s, background .12s; } }
</style>
</head>
<body>
<header>
  <div class="brand"><b>todopi</b><span id="root">connecting…</span></div>
  <nav aria-label="Views">
    <button data-view="columns">Columns</button>
    <button data-view="tree">Tree</button>
    <button data-view="ready">Ready</button>
  </nav>
  <div class="live" id="live" title="Updates arrive as the ledger files change"><i></i><span>connecting</span></div>
</header>
<p class="notice" id="notice" hidden></p>
<main id="main"></main>
<aside class="drawer" id="drawer" hidden aria-label="Task details"></aside>
<script>
"use strict";
const COLUMNS = ["open", "blocked", "in progress", "done", "closed"];
const DOT = { "open": "--c-open", "blocked": "--c-blocked", "in progress": "--c-progress", "done": "--c-done", "closed": "--c-closed" };
let board = null;
let view = "columns";
let selected = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}
function dot(e, column) { e.style.setProperty("--dot", "var(" + (DOT[column] || "--c-open") + ")"); return e; }
function byId() { const m = new Map(); for (const t of board.tasks) m.set(t.id, t); return m; }

function readHash() {
  const [v, t] = location.hash.replace(/^#/, "").split("/");
  view = ["columns", "tree", "ready"].includes(v) ? v : "columns";
  selected = t || null;
}
function writeHash() { history.replaceState(null, "", "#" + view + (selected ? "/" + selected : "")); }

function chips(t) {
  const box = el("div", "chips");
  if (t.assignee) box.append(el("span", "chip" + (t.mine ? " mine" : ""), "@" + t.assignee));
  if (t.stale) box.append(el("span", "chip warn", "stale"));
  if (t.unverified) box.append(el("span", "chip bad", "unverified"));
  if (t.ready) box.append(el("span", "chip good", "ready"));
  if (t.child_progress) box.append(el("span", "chip", t.child_progress.closed + "/" + t.child_progress.total + " children"));
  for (const l of t.labels) box.append(el("span", "chip", l));
  return box;
}
function card(t) {
  const c = el("button", "card");
  c.type = "button";
  c.append(el("div", "id", t.id), el("div", "title", t.title));
  const ch = chips(t);
  if (ch.childElementCount > 0) c.append(ch);
  c.addEventListener("click", () => openTask(t.id));
  return c;
}
function row(t, n) {
  const r = el("button", "row" + (t.status === "closed" ? " closed" : ""));
  r.type = "button";
  if (n !== undefined) r.append(el("span", "n", n));
  r.append(dot(el("span", "dot"), t.column), el("span", "id", t.id), el("span", "title", t.title));
  if (t.child_progress) r.append(el("span", "chip", t.child_progress.closed + "/" + t.child_progress.total));
  r.addEventListener("click", () => openTask(t.id));
  return r;
}

function renderColumns(main) {
  const grid = el("div", "columns");
  for (const c of COLUMNS) {
    const tasks = board.tasks.filter((t) => t.column === c);
    const col = el("section", "col");
    const h = el("h2");
    h.append(dot(el("i"), c), el("span", "", c), el("em", "", tasks.length));
    const stack = el("div", "stack");
    if (tasks.length === 0) stack.append(el("div", "empty", "Nothing here."));
    for (const t of tasks) stack.append(card(t));
    col.append(h, stack);
    grid.append(col);
  }
  main.append(grid);
}
function renderTree(main) {
  const ids = byId();
  const kids = new Map();
  const roots = [];
  for (const t of board.tasks) {
    if (t.parent && ids.has(t.parent)) {
      if (!kids.has(t.parent)) kids.set(t.parent, []);
      kids.get(t.parent).push(t);
    } else roots.push(t);
  }
  const seen = new Set();
  const branch = (t) => {
    const box = el("div");
    box.append(row(t));
    const children = kids.get(t.id) || [];
    if (children.length > 0 && !seen.has(t.id)) {
      seen.add(t.id);
      const k = el("div", "kids");
      for (const c of children) k.append(branch(c));
      box.append(k);
    }
    return box;
  };
  const tree = el("div", "tree");
  if (roots.length === 0) tree.append(el("div", "empty", "No tasks yet. Add one with todopi add."));
  for (const t of roots) tree.append(branch(t));
  main.append(tree);
}
function renderReady(main) {
  const ids = byId();
  const list = el("div", "ready");
  if (board.ready.length === 0) list.append(el("div", "empty", "Nothing is ready: everything open is claimed, blocked, or has open children."));
  board.ready.forEach((id, i) => { const t = ids.get(id); if (t) list.append(row(t, i + 1)); });
  main.append(list);
}

function field(dl, name, value) {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return;
  const dd = el("dd");
  if (value instanceof Node) dd.append(value); else dd.textContent = String(value);
  dl.append(el("dt", "", name), dd);
}
function links(list) {
  const span = el("span");
  list.forEach((id, i) => {
    if (i > 0) span.append(", ");
    const b = el("button", "link", id);
    b.type = "button";
    b.addEventListener("click", () => openTask(id));
    span.append(b);
  });
  return span;
}
function argsText(args, skip) {
  return Object.entries(args).filter(([k]) => !skip.includes(k)).map(([k, v]) => k + "=" + v).join(" ");
}
function entry(e, cls) {
  const li = el("li", cls || "");
  if (e.malformed) { li.append(el("pre", "", e.raw)); return li; }
  li.append(el("div", "when", e.timestamp + " · " + e.actor));
  const head = el("div");
  head.append(el("span", "verb", e.verb));
  const a = argsText(e.args, []);
  if (a) head.append(" ", el("span", "args", a));
  li.append(head);
  if (e.text) li.append(el("div", "text", e.text));
  return li;
}

function renderDrawer() {
  const d = document.getElementById("drawer");
  const t = selected && board ? byId().get(selected) : null;
  if (!t) { d.hidden = true; d.replaceChildren(); return; }
  d.replaceChildren();
  const close = el("button", "close", "Close");
  close.type = "button";
  close.addEventListener("click", () => openTask(null));
  const top = el("div", "id mono", t.id);
  d.append(close, top, el("h1", "", t.title), chips(t));

  const dl = el("dl");
  field(dl, "Status", t.status + (t.resolution ? " (" + t.resolution + ")" : ""));
  field(dl, "Assignee", t.assignee);
  field(dl, "Parent", t.parent ? links([t.parent]) : undefined);
  field(dl, "Blocked by", t.blocked_by.length ? links(t.blocked_by) : undefined);
  field(dl, "Rank", t.rank);
  field(dl, "Created", t.created);
  field(dl, "Updated", t.updated);
  const v = t.verify ? el("span", "mono", t.verify) : undefined;
  field(dl, "Verify", v);
  d.append(el("h3", "", "Details"), dl);

  if (t.description) { d.append(el("h3", "", "Description"), el("p", "prose", t.description)); }

  d.append(el("h3", "", "Acceptance criteria"));
  const notes = t.acceptance_notes || [];
  const noteAt = (n) => notes.filter((x) => x.after === n).map((x) => el("p", "note", x.text));
  const ul = el("ul", "criteria");
  for (const x of noteAt(0)) d.append(x);
  if (t.acceptance.length === 0) d.append(el("div", "empty", "No checkbox criteria."));
  for (const c of t.acceptance) {
    const li = el("li", c.checked ? "done" : "");
    li.append(el("span", "box", c.checked ? "\\u2611" : "\\u2610"), el("span", "num", c.n + "."), el("span", "", c.text));
    ul.append(li);
    for (const x of noteAt(c.n)) ul.append(x);
  }
  if (t.acceptance.length > 0) d.append(ul);

  d.append(el("h3", "", "Verification evidence"));
  const ev = t.log.filter((e) => !e.malformed && e.args && e.args.verify !== undefined);
  if (ev.length === 0) {
    d.append(el("div", "empty", t.verify ? "Not run yet: the verify command runs when the task is marked done." : "No verify command, and no verification recorded."));
  } else {
    const list = el("ul", "entries evidence");
    for (const e of ev) {
      const li = entry(e, e.args.verify === "pass" ? "pass" : e.args.verify === "fail" ? "fail" : "");
      list.append(li);
    }
    d.append(list);
  }

  d.append(el("h3", "", "Log (" + t.log_total + ")"));
  const log = el("ul", "entries");
  for (const e of t.log) log.append(entry(e));
  if (t.log.length === 0) d.append(el("div", "empty", "No entries."));
  else d.append(log);
  d.hidden = false;
}

function render() {
  for (const b of document.querySelectorAll("nav button")) {
    if (b.dataset.view === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  const main = document.getElementById("main");
  main.replaceChildren();
  if (!board) { main.append(el("div", "empty", "Waiting for the ledger…")); return; }
  document.getElementById("root").textContent = board.root;
  document.title = "todopi · " + board.root.split(/[\\\\/]/).filter(Boolean).pop();
  const notice = document.getElementById("notice");
  if (board.invalid.length > 0) {
    notice.textContent = board.invalid.length + " task file(s) are not valid and are not shown: " + board.invalid.join(", ") + ". Run todopi doctor to see why.";
    notice.hidden = false;
  } else notice.hidden = true;
  if (view === "tree") renderTree(main); else if (view === "ready") renderReady(main); else renderColumns(main);
  renderDrawer();
}
function openTask(id) { selected = id; writeHash(); renderDrawer(); }

for (const b of document.querySelectorAll("nav button")) {
  b.addEventListener("click", () => { view = b.dataset.view; writeHash(); render(); });
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && selected) openTask(null); });
window.addEventListener("hashchange", () => { readHash(); render(); });

function live(state, text) {
  const l = document.getElementById("live");
  l.className = "live " + state;
  l.lastChild.textContent = text;
}
readHash();
render();
const events = new EventSource("/events");
events.onopen = () => live("on", "live");
events.onmessage = (m) => { board = JSON.parse(m.data); live("on", "live"); render(); };
events.addEventListener("failure", (m) => { live("off", "cannot read the ledger"); document.getElementById("notice").textContent = JSON.parse(m.data); document.getElementById("notice").hidden = false; });
events.onerror = () => live("off", "reconnecting");
</script>
</body>
</html>
`;
