import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runClaim } from "../../src/commands/claim.ts";
import { runClose } from "../../src/commands/close.ts";
import { runNote } from "../../src/commands/note.ts";
import { runBoard, parsePort } from "../../src/commands/board.ts";
import { runLs } from "../../src/commands/ls.ts";
import { runShow } from "../../src/commands/show.ts";
import { startBoardServer, PortInUseError, type BoardServer } from "../../src/board/server.ts";
import { signature, watchTree } from "../../src/board/watch.ts";
import { EventEmitter } from "node:events";
import type { FSWatcher } from "node:fs";
import { renameSync, mkdirSync } from "node:fs";
import { BOARD_PAGE } from "../../src/output/render/board-page.ts";
import { EXIT, CliError } from "../../src/exit.ts";

const ME = "me@host";
function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-board-"));
  runInit({ directory: d, prefix: "tp" });
  return d;
}
const taskPath = (d: string, id: string) => join(d, ".todopi", "tasks", `${id}.md`);
const edit = (d: string, id: string, f: (s: string) => string) =>
  writeFileSync(taskPath(d, id), f(readFileSync(taskPath(d, id), "utf8")));
const code = (c: number) => (e: unknown) => e instanceof CliError && e.code === c;

// ---- 数据 ----

test("五列：open / blocked / in progress / done / closed；closed 按 resolution 分", () => {
  const d = repo();
  const open = runAdd({ directory: d, title: "open one", actor: ME });
  const blocker = runAdd({ directory: d, title: "blocker", actor: ME });
  const blocked = runAdd({ directory: d, title: "blocked one", blockedBy: [blocker.id], actor: ME });
  const doing = runAdd({ directory: d, title: "doing", actor: ME });
  runClaim({ directory: d, id: doing.id, actor: ME });
  const dropped = runAdd({ directory: d, title: "dropped", actor: ME });
  runClose({ directory: d, id: dropped.id, actor: ME, resolution: "wontfix" });
  const finished = runAdd({ directory: d, title: "finished", actor: ME });
  runClose({ directory: d, id: finished.id, actor: ME, resolution: "obsolete" });
  edit(d, finished.id, (s) => s.replace('resolution: "obsolete"', 'resolution: "done"'));

  const col = new Map(runBoard({ directory: d, actor: ME }).tasks.map((t) => [t.id, t.column]));
  assert.equal(col.get(open.id), "open");
  assert.equal(col.get(blocker.id), "open");
  assert.equal(col.get(blocked.id), "blocked");
  assert.equal(col.get(doing.id), "in progress");
  assert.equal(col.get(dropped.id), "closed");
  assert.equal(col.get(finished.id), "done");
});

test("板数据：每个任务的详情与 show --full 相同（Log 全量）；顺序与 ready 队列同 ls；坏文件进 invalid", () => {
  const d = repo();
  const a = runAdd({ directory: d, title: "A", acceptance: ["one", "two"], verify: "true", actor: ME });
  for (let i = 0; i < 7; i++) runNote({ directory: d, id: a.id, text: `note ${i}`, actor: ME });
  const b = runAdd({ directory: d, title: "B", actor: ME });
  runAdd({ directory: d, title: "C", blockedBy: [b.id], actor: ME });
  const bad = runAdd({ directory: d, title: "bad", actor: ME });
  edit(d, bad.id, (s) => s.replace('status: "open"', 'status: "wat"'));

  const board = runBoard({ directory: d, actor: ME });
  const full = runShow({ directory: d, id: a.id, full: true, actor: ME });
  const mine = board.tasks.find((t) => t.id === a.id)!;
  const { column, ...rest } = mine;
  assert.equal(column, "open");
  assert.deepEqual(rest, full);
  assert.equal(mine.log.length, 8, "Log 全量，不是最近 5 条");
  assert.deepEqual(board.tasks.map((t) => t.id), runLs({ directory: d, all: true, actor: ME }).tasks.map((t) => t.id));
  assert.deepEqual(board.ready, runLs({ directory: d, ready: true, actor: ME }).tasks.map((t) => t.id));
  assert.deepEqual(board.invalid, [bad.id]);
  assert.equal(board.root, d);
});

test("看板只读：算一次板数据不改任何文件", () => {
  const d = repo();
  const t = runAdd({ directory: d, title: "A", actor: ME });
  runClaim({ directory: d, id: t.id, actor: ME });
  const before = signature(join(d, ".todopi"));
  runBoard({ directory: d, actor: ME });
  assert.equal(signature(join(d, ".todopi")), before);
});

test("--port：1–65535 的十进制整数，其余退出 1", () => {
  assert.equal(parsePort("4747"), 4747);
  assert.equal(parsePort("1"), 1);
  assert.equal(parsePort("65535"), 65535);
  for (const bad of ["0", "65536", "0x10", "1.5", "-1", "", "080", " 80", "1e3"]) {
    assert.throws(() => parsePort(bad), code(EXIT.usage), bad);
  }
});

// ---- 页面 ----

test("页面：没有外部资源、没有表单、没有 fetch；数据只从 /events 来；任务内容经 textContent", () => {
  assert.doesNotMatch(BOARD_PAGE, /https?:\/\//);
  assert.doesNotMatch(BOARD_PAGE, /<form|<input|<link|<img|src=/i);
  assert.doesNotMatch(BOARD_PAGE, /\bfetch\(|XMLHttpRequest|innerHTML|insertAdjacentHTML|document\.write/);
  assert.match(BOARD_PAGE, /new EventSource\("\/events"\)/);
  for (const c of ["open", "blocked", "in progress", "done", "closed"]) assert.match(BOARD_PAGE, new RegExp(`"${c}"`));
  // 页面里的脚本能被解析（模板字符串里的反斜杠转义写错会在这里暴露）
  const script = /<script>([\s\S]*)<\/script>/.exec(BOARD_PAGE)![1]!;
  assert.doesNotThrow(() => new Function(script));
});

// ---- 服务器 ----

type Reply = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
function get(port: number, path: string, opts: { method?: string; host?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: opts.method ?? "GET",
      headers: { host: opts.host ?? `127.0.0.1:${port}` } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** 订阅 SSE，收到的每一帧交给 onFrame；返回关闭函数。 */
function subscribe(port: number, onFrame: (frame: string) => void): () => void {
  let buf = "";
  const req = request({ host: "127.0.0.1", port, path: "/events", headers: { host: `127.0.0.1:${port}` } }, (res) => {
    res.setEncoding("utf8");
    res.on("data", (c: string) => {
      buf += c;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) { onFrame(buf.slice(0, i)); buf = buf.slice(i + 2); }
    });
  });
  req.on("error", () => undefined);
  req.end();
  return () => req.destroy();
}

function frames(port: number) {
  const got: string[] = [];
  const waiters: (() => void)[] = [];
  const close = subscribe(port, (f) => { got.push(f); for (const w of waiters.splice(0)) w(); });
  const next = (n: number, ms = 3000) => new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for frame ${n}; got ${got.length}`)), ms);
    const check = () => { if (got.length >= n) { clearTimeout(timer); resolve(got[n - 1]!); } else waiters.push(check); };
    check();
  });
  return { got, next, close };
}

/** 每 300ms 改一次文件，直到 `wait` 完成：事件延迟或被合并都不影响「最终会推送」的断言。 */
async function keepWriting<T>(path: string, wait: () => Promise<T>): Promise<T> {
  let i = 0;
  const timer = setInterval(() => writeFileSync(path, `w${i++}`), 300);
  try { return await wait(); } finally { clearInterval(timer); }
}

/** 等待真实回调，避免测试进程繁忙时固定 sleep 比轮询先醒。 */
function callbacks() {
  let count = 0;
  const waiters: Array<{ n: number; done: () => void }> = [];
  const called = () => {
    count++;
    for (const waiter of [...waiters]) {
      if (count >= waiter.n) waiter.done();
    }
  };
  const next = (n: number, ms = 3000) => new Promise<void>((resolve, reject) => {
    if (count >= n) { resolve(); return; }
    const timer = setTimeout(() => {
      waiters.splice(waiters.indexOf(waiter), 1);
      reject(new Error(`timed out waiting for callback ${n}; got ${count}`));
    }, ms);
    const waiter = { n, done: () => { clearTimeout(timer); waiters.splice(waiters.indexOf(waiter), 1); resolve(); } };
    waiters.push(waiter);
  });
  return { called, next, get count() { return count; } };
}

async function withServer(opts: { poll?: boolean; build?: () => string; dir?: string }, f: (s: BoardServer, d: string) => Promise<void>) {
  const d = opts.dir ?? repo();
  let n = 0;
  const s = await startBoardServer({
    port: 0, page: "<p>page</p>", watchDir: join(d, ".todopi"), poll: opts.poll, pollMs: 50,
    build: opts.build ?? (() => JSON.stringify({ n: ++n, tasks: readFileSync(join(d, ".todopi", "config.yml"), "utf8") })),
  });
  try { await f(s, d); } finally { await s.close(); }
}

test("服务器：GET / 给页面（带 CSP、no-store）；只认回环的 Host；只读（POST 405）；未知路径 404", async () => {
  await withServer({}, async (s) => {
    const page = await get(s.port, "/");
    assert.equal(page.status, 200);
    assert.equal(page.body, "<p>page</p>");
    assert.match(String(page.headers["content-security-policy"]), /default-src 'none'/);
    assert.equal(page.headers["cache-control"], "no-store");
    assert.equal((await get(s.port, "/", { host: `localhost:${s.port}` })).status, 200);
    for (const host of ["evil.example", `evil.example:${s.port}`, `127.0.0.1:${s.port + 1}`, "127.0.0.1"]) {
      assert.equal((await get(s.port, "/", { host })).status, 403, `Host ${host}`);
      assert.equal((await get(s.port, "/events", { host })).status, 403, `Host ${host} on /events`);
    }
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const r = await get(s.port, "/", { method });
      assert.equal(r.status, 405, method);
      assert.equal(r.headers["allow"], "GET, HEAD");
    }
    // 不带 Host 头（HTTP/1.0）：拒绝
    const raw = await new Promise<string>((resolve) => {
      const sock = connect(s.port, "127.0.0.1", () => sock.end("GET / HTTP/1.0\r\n\r\n"));
      let out = "";
      sock.on("data", (c) => (out += c));
      sock.on("end", () => resolve(out));
    });
    assert.match(raw, /^HTTP\/1\.[01] 403/);
    assert.equal((await get(s.port, "/", { method: "HEAD" })).status, 200);
    assert.equal((await get(s.port, "/tasks/x")).status, 404);
  });
});

test("SSE：连上先推一份全量；文件变化后推新数据；数据没变不推", async () => {
  let version = 1;
  const d = repo();
  await withServer({ dir: d, build: () => JSON.stringify({ version }) }, async (s) => {
    assert.equal(s.mode, "watch");
    const f = frames(s.port);
    try {
      assert.equal(await f.next(1), 'data: {"version":1}');
      // 文件变了但数据没变：不推
      writeFileSync(join(d, ".todopi", "tasks", "noise.txt"), "x");
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(f.got.length, 1, "数据没变不该推");
      version = 2;
      // macOS 的 FSEvents 在整套测试并行跑时可能延迟好几秒：一直写到收到为止，只断言「会推、推的是新数据」
      assert.equal(await keepWriting(join(d, ".todopi", "tasks", "noise.txt"), () => f.next(2, 10000)), 'data: {"version":2}');
    } finally { f.close(); }
  });
});

test("SSE：强制轮询时照样推送；build 抛错推 failure 事件，服务照常", async () => {
  let fail = false;
  let version = 1;
  const d = repo();
  await withServer({ dir: d, poll: true, build: () => { if (fail) throw new Error("ledger unreadable"); return JSON.stringify({ version }); } }, async (s) => {
    assert.equal(s.mode, "poll");
    const f = frames(s.port);
    try {
      await f.next(1);
      fail = true;
      writeFileSync(join(d, ".todopi", "tasks", "a.md"), "1");
      assert.equal(await f.next(2), 'event: failure\ndata: "ledger unreadable"');
      fail = false; version = 3;
      writeFileSync(join(d, ".todopi", "tasks", "a.md"), "22");
      assert.equal(await f.next(3), 'data: {"version":3}');
      assert.equal((await get(s.port, "/")).status, 200);
    } finally { f.close(); }
  });
});

test("端口被占用：PortInUseError，不换端口", async () => {
  const blocker = createServer();
  await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", () => r()));
  const port = (blocker.address() as { port: number }).port;
  try {
    const d = repo();
    await assert.rejects(startBoardServer({ port, page: "", watchDir: join(d, ".todopi"), build: () => "{}" }),
      (e: unknown) => e instanceof PortInUseError && e.port === port);
  } finally { blocker.close(); }
});

test("轮询的签名：文件名、mtime、大小有一样变就不同；目录没了是空串", () => {
  const d = repo();
  const dir = join(d, ".todopi");
  const a = signature(dir);
  assert.equal(signature(dir), a);
  writeFileSync(join(dir, "tasks", "x.md"), "1");
  const b = signature(dir);
  assert.notEqual(b, a);
  writeFileSync(join(dir, "tasks", "x.md"), "12");
  assert.notEqual(signature(dir), b);
  const c = signature(dir);
  utimesSync(join(dir, "tasks", "x.md"), new Date(2001, 1, 1), new Date(2001, 1, 1));
  assert.notEqual(signature(dir), c, "大小不变、只改了 mtime 也算变化");
  assert.equal(signature(join(d, "nope")), "");
});

test("变化合并：一阵连续写入只重算寥寥几次；轮询在一次变化后不会每轮都重算", async () => {
  for (const poll of [false, true]) {
    let builds = 0;
    const d = repo();
    await withServer({ dir: d, poll, build: () => JSON.stringify({ b: ++builds }) }, async (s) => {
      const f = frames(s.port);
      try {
        await f.next(1);
        const base = builds;
        for (let i = 0; i < 10; i++) writeFileSync(join(d, ".todopi", "tasks", `burst-${i}.md`), String(i));
        await f.next(2, 10000);
        await new Promise((r) => setTimeout(r, 400));
        // 十次写入远少于十次重算：负载高时 FSEvents 会分几批送、兜底轮询也会算一次，所以上限是 4 而不是 1
        assert.ok(builds - base <= 4, `poll=${poll}: ${builds - base} builds for one burst of 10 writes`);
      } finally { f.close(); }
    });
  }
});

test("新连上的客户端拿到最新数据；数据变了，已连着的客户端也一起收到", async () => {
  let version = 1;
  await withServer({ build: () => JSON.stringify({ version }) }, async (s) => {
    const a = frames(s.port);
    try {
      assert.equal(await a.next(1), 'data: {"version":1}');
      version = 2;
      const b = frames(s.port);
      try {
        assert.equal(await b.next(1), 'data: {"version":2}');
        assert.equal(await a.next(2), 'data: {"version":2}');
      } finally { b.close(); }
    } finally { a.close(); }
  });
});

test("监听运行中报错：改为轮询，之后的变化照样回调（F18 评审）", async () => {
  const d = repo();
  const dir = join(d, ".todopi");
  const fake = new EventEmitter() as EventEmitter & { close: () => void };
  let closed = false;
  fake.close = () => { closed = true; };
  const cb = callbacks();
  const w = watchTree(dir, cb.called, { pollMs: 30, watchFn: () => fake as unknown as FSWatcher });
  try {
    assert.equal(w.mode, "watch");
    fake.emit("error", new Error("inotify gone"));
    assert.equal(w.mode, "poll");
    assert.ok(closed, "旧的监听关掉");
    await cb.next(1);
    writeFileSync(join(dir, "tasks", "after-error.md"), "x");
    await cb.next(2);
  } finally { w.close(); }
});

test("被监听的目录改名后重建：改为轮询，重建后的变化照样推送（F18 评审）", async () => {
  const d = repo();
  const dir = join(d, ".todopi");
  let version = 1;
  await withServer({ dir: d, build: () => JSON.stringify({ version }) }, async (s) => {
    const f = frames(s.port);
    try {
      await f.next(1);
      renameSync(dir, join(d, ".todopi-old"));
      mkdirSync(join(dir, "tasks"), { recursive: true });
      await new Promise((r) => setTimeout(r, 1300));
      version = 2;
      writeFileSync(join(dir, "tasks", "new.md"), "x");
      await f.next(2, 4000);
      assert.equal(f.got.at(-1), 'data: {"version":2}');
    } finally { f.close(); }
  });
});

test("监听回调时目录已不在：改为轮询（Linux 上 inotify 不会跟到重建的目录，与平台无关地钉住）", () => {
  const d = repo();
  const dir = join(d, ".todopi");
  let listener: () => void = () => undefined;
  const fake = new EventEmitter() as EventEmitter & { close: () => void };
  fake.close = () => undefined;
  const w = watchTree(dir, () => undefined, { pollMs: 30, watchFn: (_d, _o, l) => { listener = l; return fake as unknown as FSWatcher; } });
  try {
    listener();
    assert.equal(w.mode, "watch", "目录还在：继续监听");
    renameSync(dir, join(d, ".todopi-old"));
    listener();
    assert.equal(w.mode, "poll");
  } finally { w.close(); }
});

test("回调到达时目录已被改名并重建（inode 换了）：同样改为轮询（评审二轮：只看存在与否会漏掉这个竞态）", async () => {
  const d = repo();
  const dir = join(d, ".todopi");
  let listener: () => void = () => undefined;
  const fake = new EventEmitter() as EventEmitter & { close: () => void };
  fake.close = () => undefined;
  const cb = callbacks();
  const w = watchTree(dir, cb.called, { pollMs: 30, watchFn: (_d, _o, l) => { listener = l; return fake as unknown as FSWatcher; } });
  try {
    renameSync(dir, join(d, ".todopi-old"));
    mkdirSync(join(dir, "tasks"), { recursive: true });
    listener();
    assert.equal(w.mode, "poll");
    await cb.next(1);
    writeFileSync(join(dir, "tasks", "x.md"), "1");
    await cb.next(2);
  } finally { w.close(); }
});

test("watch 模式下的兜底轮询：监听丢了事件（从不触发），变化也会在轮询间隔的 5 倍内被发现", async () => {
  const d = repo();
  const dir = join(d, ".todopi");
  const fake = new EventEmitter() as EventEmitter & { close: () => void };
  fake.close = () => undefined;
  const cb = callbacks();
  const w = watchTree(dir, cb.called, { pollMs: 20, watchFn: () => fake as unknown as FSWatcher });
  try {
    assert.equal(w.mode, "watch");
    writeFileSync(join(dir, "tasks", "silent.md"), "x");
    await cb.next(1);
    assert.equal(w.mode, "watch", "仍是 watch 模式");
  } finally { w.close(); }
});
