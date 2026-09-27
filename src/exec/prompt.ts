// src/exec/prompt.ts
// 在终端里问一个是 / 否的问题（FR-D4：首次执行 verify 前确认，F26）。不认识 todopi 的格式。
//
// 只在 stdin 与 stderr 都是终端时才问：问题写在 stderr（stdout 留给结果与 --json），答案从 stdin 读。任何一个不是终端
// （agent 在管道里调用、输出被重定向）就不问——F07 立的规矩：绝不阻塞在一个看不见的提示上。

import { readSync } from "node:fs";

export function canAsk(): boolean {
  return process.stdin.isTTY === true && process.stderr.isTTY === true;
}

/**
 * 读一行答案。行尾是 LF 或 CR（raw 模式的终端里回车送的是 CR，只认 LF 会一直等下去）。**EOF 一律返回 null**——
 * 哪怕前面已经敲了 `y`：没有以回车确认的输入不算回答（`y` 之后 Ctrl-D 曾被当成同意，F26 评审）。
 * `readByte` 返回下一个字节，EOF 返回 null；注入是为了测试。
 */
export function readAnswer(readByte: () => number | null): string | null {
  const bytes: number[] = [];
  for (;;) {
    const b = readByte();
    if (b === null) return null;
    if (b === 0x0a || b === 0x0d) return Buffer.from(bytes).toString("utf8");
    bytes.push(b);
  }
}

/** 从 stdin 同步读一个字节。同步读：调用方在一条同步的命令路径上，没有事件循环可等。 */
function stdinByte(): number | null {
  const buf = Buffer.alloc(1);
  for (;;) {
    try {
      return readSync(0, buf, 0, 1, null) === 0 ? null : buf[0]!;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // 非阻塞的 stdin 暂时没数据：等一会儿再读
      if (code === "EAGAIN") { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); continue; }
      if (code === "EOF") return null;
      throw err;
    }
  }
}

/** 问一次；答 y / yes（不分大小写）才是 true，其余（含空行、EOF）都是 false。 */
export function askYesNo(question: string): boolean {
  process.stderr.write(`${question} [y/N] `);
  const answer = readAnswer(stdinByte);
  if (answer === null) process.stderr.write("\n");
  return answer !== null && /^\s*y(es)?\s*$/i.test(answer);
}
