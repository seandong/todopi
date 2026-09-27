// src/exec/prompt.ts
// 在终端里问一个是 / 否的问题（FR-D4：首次执行 verify 前确认，F26）。不认识 todopi 的格式。
//
// 只在 stdin 与 stderr 都是终端时才问：问题写在 stderr（stdout 留给结果与 --json），答案从 stdin 读。任何一个不是终端
// （agent 在管道里调用、输出被重定向）就不问——F07 立的规矩：绝不阻塞在一个看不见的提示上。

import { readSync } from "node:fs";

export function canAsk(): boolean {
  return process.stdin.isTTY === true && process.stderr.isTTY === true;
}

/** 读一行（不含换行）。EOF 返回 null。同步读：调用方在一条同步的命令路径上，没有事件循环可等。 */
function readLine(): string | null {
  const buf = Buffer.alloc(1);
  const bytes: number[] = [];
  for (;;) {
    let n: number;
    try {
      n = readSync(0, buf, 0, 1, null);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // 非阻塞的 stdin 暂时没数据：等一会儿再读
      if (code === "EAGAIN") { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); continue; }
      if (code === "EOF") n = 0;
      else throw err;
    }
    if (n === 0) return bytes.length === 0 ? null : Buffer.from(bytes).toString("utf8");
    if (buf[0] === 0x0a) return Buffer.from(bytes).toString("utf8").replace(/\r$/, "");
    bytes.push(buf[0]!);
  }
}

/** 问一次；答 y / yes（不分大小写）才是 true，其余（含空行、EOF）都是 false。 */
export function askYesNo(question: string): boolean {
  process.stderr.write(`${question} [y/N] `);
  const answer = readLine();
  if (answer === null) process.stderr.write("\n");
  return answer !== null && /^\s*y(es)?\s*$/i.test(answer);
}
