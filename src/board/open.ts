// src/board/open.ts
// `web --open`：用系统的命令打开浏览器。失败只返回 false，由调用方提示——看板本身照常运行。

import { spawn } from "node:child_process";

export function openInBrowser(url: string): Promise<boolean> {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : ["xdg-open", [url]];
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}
