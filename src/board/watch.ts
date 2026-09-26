// src/board/watch.ts
// FR-B4 的「文件变化」：递归监听一个目录，变化合并 100ms 后回调一次。
//
// 退化为轮询的三种情形：fs.watch 抛错（有的平台 / 文件系统不支持）、在 WSL 下（drvfs 与 9p 上的 fs.watch 不报错，
// 但也不触发——没法检测出来，只能按环境判断）、调用方强制（容器的挂载卷同理，给用户 `--poll`）。
// 轮询比较的是「文件名 + mtime + 大小」的签名。

import { readdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

const DEBOUNCE_MS = 100;

export type TreeWatcher = { mode: "watch" | "poll"; close: () => void };

/** WSL 的内核版本串里带 microsoft（WSL1 与 WSL2 都是）。 */
export function underWsl(): boolean {
  try {
    return /microsoft/i.test(readFileSync("/proc/sys/kernel/osrelease", "utf8"));
  } catch {
    return false;
  }
}

/** 目录下全部文件的签名；目录没了返回空串（会被当成一次变化）。 */
export function signature(dir: string): string {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();
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

export function watchTree(dir: string, onChange: () => void, opts: { poll?: boolean; pollMs?: number } = {}): TreeWatcher {
  let pending: NodeJS.Timeout | null = null;
  const changed = (): void => {
    if (pending !== null) return;
    pending = setTimeout(() => { pending = null; onChange(); }, DEBOUNCE_MS);
  };
  const clear = (): void => { if (pending !== null) clearTimeout(pending); };

  if (opts.poll !== true && !underWsl()) {
    let watcher: FSWatcher | null = null;
    try {
      watcher = watch(dir, { recursive: true }, changed);
      // 目录被删之类：看板照常，下次变化靠用户刷新
      watcher.on("error", () => undefined);
    } catch {
      watcher = null;
    }
    if (watcher !== null) {
      const w = watcher;
      return { mode: "watch", close: () => { clear(); w.close(); } };
    }
  }

  let prev = signature(dir);
  const timer = setInterval(() => {
    const next = signature(dir);
    if (next !== prev) { prev = next; changed(); }
  }, opts.pollMs ?? 1000);
  return { mode: "poll", close: () => { clear(); clearInterval(timer); } };
}
