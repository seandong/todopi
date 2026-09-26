// src/board/server.ts
// FR-B1 / FR-B4：本地看板的 HTTP 服务。只监听 127.0.0.1，只读：GET / 给页面，GET /events 是 SSE。
// 不认识 todopi 的格式——页面与数据都由调用方注入（`build` 每次返回一份完整的 JSON）。
//
// 这是 src/ 里唯一允许监听端口的地方（ARCH-001 / ARCH-002 的 src/board/ 例外）。
//
// **Host 头必须是回环地址**：只绑 127.0.0.1 挡不住 DNS rebinding——恶意网页把自己的域名解析到 127.0.0.1，
// 浏览器就会把它当成同源，读走看板上的任务内容。浏览器发来的 Host 是那个域名，据此拒绝。

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { watchTree } from "./watch.ts";

export type BoardServerOptions = {
  port: number;
  /** 页面 HTML（整页，资源全部内联） */
  page: string;
  /** 算一份当前的看板数据（JSON 文本，单行）。抛错时推一条 error 事件，服务照常运行。 */
  build: () => string;
  /** 监听这个目录（递归）的变化 */
  watchDir: string;
  /** 强制轮询 */
  poll?: boolean;
  /** 轮询间隔，毫秒（用例调小） */
  pollMs?: number;
};

export type BoardServer = { port: number; mode: "watch" | "poll"; close: () => Promise<void> };

/** 端口被占用：调用方据此给出提示，不换端口。 */
export class PortInUseError extends Error {
  readonly port: number;
  constructor(port: number) {
    super(`port ${port} is in use`);
    this.port = port;
  }
}

const HOST = "127.0.0.1";

export function startBoardServer(opts: BoardServerOptions): Promise<BoardServer> {
  const clients = new Set<ServerResponse>();
  let last: string | null = null;

  const frame = (): string => {
    try {
      return `data: ${opts.build()}\n\n`;
    } catch (err) {
      return `event: failure\ndata: ${JSON.stringify(err instanceof Error ? err.message : String(err))}\n\n`;
    }
  };
  const refresh = (): void => {
    const next = frame();
    if (next === last) return;
    last = next;
    for (const c of clients) c.write(next);
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const port = (server.address() as { port: number }).port;
    const host = req.headers.host ?? "";
    if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }).end("Forbidden: open the board at http://127.0.0.1:" + port + "/\n");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" }).end("The board is read-only.\n");
      return;
    }
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        // 页面只从自己这里取数据；内联的脚本与样式是唯一的资源
        "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:",
      }).end(opts.page);
      return;
    }
    if (path === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
      // 先刷新：数据若在没有文件事件的情况下变了（比如 stale 随时间出现），已连着的也一起收到，不会停在旧数据上
      refresh();
      res.write(last!);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found.\n");
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(err.code === "EADDRINUSE" ? new PortInUseError(opts.port) : err);
    });
    server.listen(opts.port, "127.0.0.1", () => {
      const watcher = watchTree(opts.watchDir, refresh, { poll: opts.poll, pollMs: opts.pollMs });
      const port = (server.address() as { port: number }).port;
      resolve({
        port,
        mode: watcher.mode,
        close: () => new Promise((done) => {
          watcher.close();
          for (const c of clients) c.end();
          server.close(() => done());
        }),
      });
    });
  });
}
