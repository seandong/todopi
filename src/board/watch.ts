// src/board/watch.ts
// FR-B4 的「文件变化」：递归监听一个目录，变化合并 100ms 后回调一次。
//
// 退化为轮询的情形：fs.watch 抛错（有的平台 / 文件系统不支持）或运行中报错、被监听的目录本身没了、在 WSL 下（drvfs 与 9p 上的 fs.watch 不报错，
// 但也不触发——没法检测出来，只能按环境判断）、调用方强制（容器的挂载卷同理，给用户 `--poll`）。
// 轮询比较的是「文件名 + mtime + 大小」的签名。

import { readdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

const DEBOUNCE_MS = 100;

export type TreeWatcher = { readonly mode: "watch" | "poll"; close: () => void };

/** 用例注入假的 fs.watch 用；默认是 node:fs 的。 */
export type WatchFn = (dir: string, opts: { recursive: boolean }, listener: () => void) => FSWatcher;

/** WSL 的内核版本串里带 microsoft（WSL1 与 WSL2 都是）。 */
export function underWsl(): boolean {
  try {
    return /microsoft/i.test(readFileSync("/proc/sys/kernel/osrelease", "utf8"));
  } catch {
    return false;
  }
}

/** 目录的身份：dev + inode。目录不在返回 null。 */
function identity(dir: string): string | null {
  try {
    const s = statSync(dir);
    return `${s.dev}:${s.ino}`;
  } catch {
    return null;
  }
}

/** 目录下全部条目的相对路径。不用 readdirSync 的 recursive 选项：它要 Node 20.1 起，npm 包承诺 Node ≥ 20（F21）。 */
function listTree(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix === "" ? e.name : join(prefix, e.name);
    out.push(rel);
    if (e.isDirectory()) out.push(...listTree(dir, rel));
  }
  return out;
}

/** 目录下全部文件的签名；目录没了返回空串（会被当成一次变化）。 */
export function signature(dir: string): string {
  let names: string[];
  try {
    names = listTree(dir).sort();
  } catch {
    return "";
  }
  return names.map((n) => {
    try {
      const s = statSync(join(dir, n));
      return `${n}\u0000${s.mtimeMs}\u0000${s.size}`;
    } catch {
      return `${n}\u0000gone`;
    }
  }).join("\n");
}

export function watchTree(dir: string, onChange: () => void,
  opts: { poll?: boolean; pollMs?: number; watchFn?: WatchFn } = {}): TreeWatcher {
  let pending: NodeJS.Timeout | null = null;
  const changed = (): void => {
    if (pending !== null) return;
    pending = setTimeout(() => { pending = null; onChange(); }, DEBOUNCE_MS);
  };
  let mode: "watch" | "poll" = "poll";
  let stop: () => void = () => undefined;

  const poller = (ms: number): (() => void) => {
    let prev = signature(dir);
    const timer = setInterval(() => {
      const next = signature(dir);
      if (next !== prev) { prev = next; changed(); }
    }, ms);
    return () => clearInterval(timer);
  };
  const pollMs = opts.pollMs ?? 1000;
  const startPolling = (): void => {
    stop();
    mode = "poll";
    stop = poller(pollMs);
  };

  const root = identity(dir);
  let watcher: FSWatcher | null = null;
  if (opts.poll !== true && !underWsl()) {
    try {
      watcher = (opts.watchFn ?? watch)(dir, { recursive: true }, () => {
        // 被监听的目录本身换了（改名、删掉重建——哪怕回调到达时新目录已经建好）：inotify 挂在旧 inode 上，不会跟到
        // 新目录，改为轮询。按 dev + inode 判断，不只看存在与否（F18 评审二轮）。
        if (identity(dir) !== root) fallBack();
        changed();
      });
    } catch {
      watcher = null;
    }
  }
  // 监听中途出错（Linux 上目录被删或改名时 inotify 失效）同样改为轮询，不能从此静默（F18 评审）
  const fallBack = (): void => {
    if (mode === "poll" || watcher === null) return;
    const w = watcher;
    watcher = null;
    w.close();
    startPolling();
    changed();
  };
  if (watcher !== null) {
    mode = "watch";
    const w = watcher;
    w.on("error", fallBack);
    // 兜底的慢速轮询：macOS 的 FSEvents 在高负载下会丢事件（整套测试并行跑时实测，等 10 秒也没来），看板不能因此停在
    // 旧数据上。fs.watch 负责快，轮询负责最终一定对得上；间隔是轮询模式的 5 倍（默认 5 秒）
    stop = poller(pollMs * 5);
  } else {
    startPolling();
  }
  return {
    get mode() { return mode; },
    close: () => { if (pending !== null) clearTimeout(pending); stop(); if (watcher !== null) watcher.close(); },
  };
}
