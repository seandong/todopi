// src/exec/runner.ts
// `runCommand` 派出去的那个小进程。它负责：建组、计时、升级终止、捕获输出，
// 最后把结果作为一行 JSON 打到 stdout。
//
// **为什么要单独一个进程。** 调用方是一条一次性的 CLI 命令，整个 `done` 在文件锁
// 内串行执行，所以 `runCommand` 必须是同步的——否则锁的持有时间会变成另一件需要
// 论证的事。而「独立进程组」只有 Node 的**异步** spawn 支持（`detached: true`
// 底下是 setsid，`spawnSync` 没有这个选项）。于是把异步那部分关进一个子进程，
// 父进程用 `spawnSync` 同步等它。
//
// 走 .ts 而不是 .mjs：Node 22 的类型剥离直接跑 .ts，与仓库其余部分一致，
// 也一并受 tsc --noEmit 检查。

import { spawn } from "node:child_process";

type Payload = {
  command: string;
  cwd: string;
  timeoutMs: number | null;
  graceMs: number;
  maxOutputBytes: number;
};

const payload = JSON.parse(process.argv[2] ?? "{}") as Payload;

/** 只保留尾部：失败的原因通常在最后几行。 */
function clip(chunks: Buffer[], max: number): { text: string; truncated: boolean } {
  const all = Buffer.concat(chunks);
  if (all.length <= max) return { text: all.toString("utf8"), truncated: false };
  return { text: all.subarray(all.length - max).toString("utf8"), truncated: true };
}

const started = Date.now();
const out: Buffer[] = [];
const err: Buffer[] = [];

// **detached: true** 让它自成进程组，于是 `process.kill(-pid, sig)` 够得着孙进程。
// 实测过：不加这个，`child.kill()` 之后孙进程仍然存活，而 `pnpm test` /
// `cargo test` 都会 fork worker（PRD FR-D2 的依据）。
//
// 命令原样交给 `sh -c`，不自己切分——`verify` 是用户写的一行 shell，
// 自己切等于重新实现一个 shell，而且和他在终端里敲的不是同一个东西。
const child = spawn("/bin/sh", ["-c", payload.command], {
  cwd: payload.cwd,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout?.on("data", (c: Buffer) => out.push(c));
child.stderr?.on("data", (c: Buffer) => err.push(c));

let timedOut = false;
let termTimer: NodeJS.Timeout | undefined;
let killTimer: NodeJS.Timeout | undefined;

/** 向**整个进程组**发信号。负 pid 就是「这个组」。 */
function signalGroup(sig: NodeJS.Signals): void {
  try {
    process.kill(-child.pid!, sig);
  } catch {
    // 组已经没了，或者建组失败（那就退回到只杀直接子进程）
    try { child.kill(sig); } catch { /* 已经退出 */ }
  }
}

if (payload.timeoutMs !== null) {
  termTimer = setTimeout(() => {
    timedOut = true;
    // **先 TERM 再 KILL。** 测试框架在 SIGTERM 上刷 coverage / junit；
    // 直接 SIGKILL 会丢掉那些，还留下半截文件，而半截文件会干扰下一次 verify。
    signalGroup("SIGTERM");
    killTimer = setTimeout(() => signalGroup("SIGKILL"), payload.graceMs);
  }, payload.timeoutMs);
}

child.on("error", (e) => {
  finish(null, null, `${err.length > 0 ? "" : ""}${String(e)}`);
});

child.on("exit", (code, signal) => {
  clearTimeout(termTimer);
  clearTimeout(killTimer);
  // **正常退出后也清一次组。** 直接子进程退出不等于整棵树退出——跑完之后还活着的
  // 孙进程，和超时留下的一样是泄漏：它会继续占端口、写文件、烧 CPU。
  signalGroup("SIGKILL");
  finish(code, signal, null);
});

function finish(code: number | null, signal: string | null, error: string | null): void {
  const stdout = clip(out, payload.maxOutputBytes);
  const stderr = clip(err, payload.maxOutputBytes);
  process.stdout.write(JSON.stringify({
    code, signal, timedOut,
    stdout: stdout.text,
    stderr: error === null ? stderr.text : `${stderr.text}${error}`,
    durationMs: Date.now() - started,
    truncated: stdout.truncated || stderr.truncated,
  }));
  process.exit(0);
}
