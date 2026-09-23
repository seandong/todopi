import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../../src/exec/run.ts";

const dir = () => mkdtempSync(join(tmpdir(), "todopi-run-"));

/** 数某个字符出现了几次。用 Z 是因为它不出现在生成它的那条命令里。 */
function countChar(text: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) if (text[i] === ch) n += 1;
  return n;
}

/** 进程还在不在。信号 0 只做权限/存在性检查，不真的发信号。 */
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** 等到条件成立或超时；用来给被杀的进程一点退出时间。 */
function settle(cond: () => boolean, ms = 3000): boolean {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) if (cond()) return true;
  return false;
}

test("超时终止**整个进程组** —— 断言的是孙进程的 pid", () => {
  // 这条用例的全部价值在于它测的是**孙进程**。若改成断言父进程的退出码或
  // timedOut，把 detached 去掉它照样通过——而那正是要防的缺陷。
  // 实测过：默认方式下 child.kill() 之后孙进程仍然存活。
  const d = dir();
  const pidFile = join(d, "grandchild.pid");
  const cmd = `bash -c 'echo $$ > ${pidFile}; sleep 30' & sleep 30`;

  const r = runCommand(cmd, { cwd: d, timeoutMs: 1000 });
  assert.equal(r.timedOut, true);

  assert.ok(settle(() => existsSync(pidFile)), "孙进程没来得及写下 pid");
  const gpid = Number(readFileSync(pidFile, "utf8").trim());
  assert.ok(Number.isInteger(gpid) && gpid > 0, `pid 读不出来：${gpid}`);
  assert.ok(settle(() => !alive(gpid)), "孙进程仍然存活 —— 只杀了直接子进程");
});

test("正常退出后孙进程也不留下", () => {
  // 跑完之后还活着的孙进程，和超时留下的一样是泄漏：它会继续占端口、写文件。
  const d = dir();
  const pidFile = join(d, "grandchild.pid");
  // 先给孙进程一点写下 pid 的时间，否则父进程退得太快、整组被清掉时它还没写，
  // 用例就观察不到「它曾经存在过」——那样这条用例会因为**行为正确**而失败。
  const started = Date.now();
  const r = runCommand(`bash -c 'echo $$ > ${pidFile}; sleep 30' & sleep 0.5; exit 0`,
    { cwd: d, timeoutMs: 10_000 });
  const elapsed = Date.now() - started;
  assert.equal(r.timedOut, false);
  assert.equal(r.code, 0);

  // **而且要立刻返回。** 杀组必须发生在 `exit`，不能等 `close`——孙进程握着
  // stdout 管道，等 close 就等于等它睡完那 30 秒。只断言「最终死了」的话，
  // 那个错误实现照样绿，只是慢 30 秒；这一条把「快」也钉住。留足余量：
  // 命令自己要睡 0.5 秒。
  assert.ok(elapsed < 3_000, `跑了 ${elapsed}ms —— 杀组被推迟到了 close 之后`);

  assert.ok(settle(() => existsSync(pidFile)));
  const gpid = Number(readFileSync(pidFile, "utf8").trim());
  assert.ok(settle(() => !alive(gpid)), "正常跑完之后孙进程仍然存活");
});

test("先 SIGTERM 再 SIGKILL —— 给测试框架刷盘的机会", () => {
  // 测试框架在 SIGTERM 上写 coverage / junit。直接 SIGKILL 会丢掉它们，
  // 还留下半截文件，而半截文件会干扰**下一次** verify。
  const d = dir();
  const flushed = join(d, "flushed");
  const cmd = `trap 'echo done > ${flushed}; exit 143' TERM; sleep 30`;

  const r = runCommand(cmd, { cwd: d, timeoutMs: 800, graceMs: 2000 });
  assert.equal(r.timedOut, true);
  assert.ok(settle(() => existsSync(flushed)), "SIGTERM 没到，或者没给刷盘的时间");
});

test("宽限期过后仍然不退的，会被 SIGKILL 收掉", () => {
  const d = dir();
  // 忽略 SIGTERM，只有 SIGKILL 能杀掉它
  const r = runCommand(`trap '' TERM; sleep 30`, { cwd: d, timeoutMs: 500, graceMs: 500 });
  assert.equal(r.timedOut, true);
});

test("退出码如实返回", () => {
  const d = dir();
  assert.equal(runCommand("exit 0", { cwd: d }).code, 0);
  assert.equal(runCommand("exit 3", { cwd: d }).code, 3);
  assert.equal(runCommand("exit 1", { cwd: d }).code, 1);
});

test("命令原样交给 sh -c —— 管道、引号、&& 都能用", () => {
  // verify 是用户写的一行 shell。自己切分等于重新实现一个 shell，
  // 而且和用户在终端里敲的不是同一个东西。
  const d = dir();
  assert.equal(runCommand(`echo "a b" | tr ' ' '-'`, { cwd: d }).output.trim(), "a-b");
  assert.equal(runCommand(`true && echo yes`, { cwd: d }).output.trim(), "yes");
  assert.equal(runCommand(`echo 'single $NOTEXPANDED'`, { cwd: d }).output.trim(), "single $NOTEXPANDED");
});

test("stdout 与 stderr 都被捕获，各自保序 —— 但两路之间的先后不保证", () => {
  // 合成一路而不是分成两段：分段要把其中一路整个留在内存里。
  //
  // **不断言 one/two/three 这个顺序。** 两路是各自独立的管道，谁先被读到取决于
  // 事件循环，实测就会出现 one/three/two。如实只断言能保证的部分：都到齐了，
  // 且同一路内部保持顺序。
  const d = dir();
  const r = runCommand(`echo one; echo two >&2; echo three`, { cwd: d });
  const lines = r.output.trim().split("\n");
  assert.deepEqual([...lines].sort(), ["one", "three", "two"]);
  assert.ok(lines.indexOf("one") < lines.indexOf("three"), "同一路内部乱序了");
});

test("cwd 是给定的目录", () => {
  const d = dir();
  writeFileSync(join(d, "marker"), "x");
  assert.match(runCommand("ls", { cwd: d }).output, /marker/);
});

test("返回的尾部有上限并置 truncated —— 但完整输出没有丢", () => {
  const d = dir();
  const logPath = join(d, "full.log");
  const r = runCommand(`head -c 3000000 /dev/zero | tr '\\0' 'Z'`,
    { cwd: d, maxOutputBytes: 1024, logPath });
  assert.equal(r.truncated, true);
  assert.ok(r.output.length <= 1024 + 200, `尾部没有上限，长度 ${r.output.length}`);
  // truncated 说的是**返回值**只是尾部，不是输出丢了：日志里仍然是完整的 3 MB。
  // 只数正文段：日志头是原样的命令，而命令里自己就有一个 Z。
  const log = readFileSync(logPath, "utf8");
  const bodyAt = log.indexOf("\n\n") + 2;
  assert.equal(countChar(log.slice(bodyAt), "Z"), 3_000_000);
});

test("没超过上限时不置 truncated", () => {
  const d = dir();
  const r = runCommand("echo short", { cwd: d, maxOutputBytes: 1024 });
  assert.equal(r.truncated, false);
});

test("durationMs 有值且不为负", () => {
  const d = dir();
  assert.ok(runCommand("sleep 0.1", { cwd: d }).durationMs >= 0);
});

test("命令本身不存在时退出码非 0，而不是抛错", () => {
  // sh -c 会给出 127。让调用方按普通的失败处理，而不是崩在这里。
  const d = dir();
  const r = runCommand("definitely-not-a-real-command-xyz", { cwd: d });
  assert.notEqual(r.code, 0);
  assert.equal(r.timedOut, false);
});

test("主动脱离进程组的后代杀不到 —— 这是固有边界，如实钉住它", () => {
  // 子进程若自己调 setsid(2)（或 Node 的 detached）另起一个组，kill(-pid)
  // 就够不着它。这不是缺陷，是进程组终止的固有边界：唯一的替代是遍历 ps
  // 追整棵树，那在跨平台上既不可靠也有竞态。
  //
  // 把它写成用例，是为了让这条边界**有人知道**——哪天有人「修好」了它，
  // 这条会红，然后他会读到这段注释。
  const d = dir();
  const pidFile = join(d, "escaped.pid");
  const escape =
    `node -e 'const{spawn}=require("node:child_process");` +
    `const c=spawn("bash",["-c","echo $$ > ${pidFile}; sleep 30"],{detached:true,stdio:"ignore"});c.unref();'` +
    `; sleep 30`;

  const r = runCommand(escape, { cwd: d, timeoutMs: 1000, graceMs: 300 });
  assert.equal(r.timedOut, true);
  assert.ok(settle(() => existsSync(pidFile)), "脱离出去的进程没写下 pid");
  const gpid = Number(readFileSync(pidFile, "utf8").trim());

  const stillAlive = alive(gpid);
  try { process.kill(gpid, "SIGKILL"); } catch { /* 已退出 */ }
  assert.equal(stillAlive, true,
    "主动脱离进程组的后代本就杀不到；若这条红了，说明实现变了——" +
    "读 src/exec/run.ts 顶部关于这条边界的说明再决定是不是该改这个断言");
});

/** `ps` 能不能用。受限环境（沙箱、某些容器）里它会 EPERM。 */
function psWorks(): boolean {
  const r = spawnSync("ps", ["-o", "rss=", "-p", String(process.pid)], { encoding: "utf8" });
  return Number.isFinite(Number.parseInt((r.stdout ?? "").trim(), 10));
}

test("runner 的常驻内存有界 —— 200 MB 输出不该变成 200 MB 内存", async (t) => {
  // 这条不能走 runCommand：它是 spawnSync，中途量不到。直接起 runner，
  // 每 50ms 采一次 RSS 取峰值。
  //
  // 早先的实现把每个 chunk 攒进数组、退出时才 Buffer.concat 再截尾——返回值确实
  // 很短，所以**只断言返回值长度的测试照样绿**。要判别它，必须量运行期间的内存。
  //
  // **`ps` 不可用时明确 skip，而不是红。** Codex 评审复跑时在沙箱里撞到 EPERM，
  // 那次红说的是环境，不是实现。不变量本身由 tail.test.ts 在进程内确定性地把
  // 关，永远跑得了；这一条补的是「runner 真的用了那个环」这一段。
  if (!psWorks()) { t.skip("ps 不可用（受限环境），这次量不到常驻内存"); return; }

  const d = dir();
  const logPath = join(d, "big.log");
  const runner = join(import.meta.dirname, "../../src/exec/runner.ts");
  const arg = JSON.stringify({
    command: `head -c 200000000 /dev/zero | tr '\\0' 'Z'`,
    cwd: d, timeoutMs: null, graceMs: 1_000, maxOutputBytes: 1024, logPath,
  });
  const child = spawn(process.execPath, [runner, arg], { stdio: ["ignore", "pipe", "pipe"] });

  let peakKb = 0;
  const sampler = setInterval(() => {
    const ps = spawnSync("ps", ["-o", "rss=", "-p", String(child.pid)], { encoding: "utf8" });
    const kb = Number.parseInt((ps.stdout ?? "").trim(), 10);
    if (Number.isFinite(kb)) peakKb = Math.max(peakKb, kb);
  }, 50);

  let out = "";
  child.stdout.on("data", (c: Buffer) => { out += c.toString("utf8"); });
  await new Promise((resolve) => child.on("close", resolve));
  clearInterval(sampler);

  const size = statSync(logPath).size;
  rmSync(d, { recursive: true, force: true });

  assert.ok(peakKb > 0, "一开始 ps 还能用，采样却一次都没成功 —— 这条什么都没验证");
  // Node 自己的基线在 50 MB 上下；攒在内存里的话峰值会在 250 MB 量级（实测）。
  assert.ok(peakKb < 150_000, `runner 峰值内存 ${peakKb} KB —— 输出被攒在内存里了`);
  assert.ok(size >= 200_000_000, `日志只有 ${size} 字节，完整输出没落全`);
  assert.equal((JSON.parse(out) as { truncated: boolean }).truncated, true);
});

test("Log 里的尾部，就是日志文件输出段的最后那几个字节", () => {
  // 有了这条不变量，「尾部大概对」就变成了「尾部**是**日志的末尾」——
  // 人照着 Log 里那截去 .cache/ 里找上下文时，找到的是同一个地方。
  const d = dir();
  const logPath = join(d, "t.log");
  const command = `for i in $(seq 1 2000); do echo "line $i"; done`;
  const r = runCommand(command, { cwd: d, maxOutputBytes: 200, logPath });

  const file = readFileSync(logPath, "utf8");
  const header = `$ ${command}\n\n`;
  assert.ok(file.startsWith(header), "日志头不是原样的命令");
  const footerAt = file.lastIndexOf("\n--- exit:");
  assert.ok(footerAt > 0, "日志没有退出状态脚注");
  // 输出全是 ASCII，所以这里的字符数就是字节数。
  assert.equal(r.output, file.slice(header.length, footerAt).slice(-200));
});

test("日志写不进去时不崩 —— 命令照跑，问题随结果报告", () => {
  // 原来这里会让 runner 崩掉，于是上层把「日志写不了」误当成「命令没跑起来」。
  const d = dir();
  const logPath = join(d, "occupied");
  mkdirSync(logPath);
  const r = runCommand("echo hi", { cwd: d, logPath });
  assert.equal(r.code, 0);
  assert.match(r.output, /hi/);
  assert.notEqual(r.logProblem, null);
});

test("日志目标慢下来时有背压 —— 子进程跟着停，输出不堆进缓冲", async () => {
  // **流式写文件 ≠ 内存有界。** 若只是 `log.write(c)` 不看返回值，磁盘跟不上时
  // chunk 就从「攒在数组里」变成「攒在 WriteStream 里」——换个地方堆积不算有界。
  // `pipe` 在目标写不动时暂停源，子进程随之被堵住。
  //
  // 判据故意**不用 RSS**：那把尺子的基线就有 100 MB 上下，差距只有 1.5 倍，
  // 换台机器就可能翻车。这里问一个二值的问题——日志被挂住的那几秒里，子进程把
  // 200 MB 写完了没有？背压生效就写不完。
  const d = dir();
  const fifo = join(d, "slow.log");
  const marker = join(d, "produced-everything");
  spawnSync("mkfifo", [fifo]);
  // 先开读端（否则写端 open 会一直阻塞），但 3 秒内不抽
  const reader = spawn("sh", ["-c", `exec 3< "${fifo}"; sleep 3; cat <&3 > /dev/null`], { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 200));

  const runner = join(import.meta.dirname, "../../src/exec/runner.ts");
  const arg = JSON.stringify({
    // 不经过 tr：tr 只有 20 MB/s，瓶颈会变成它自己，两边都「写不完」。
    command: `head -c 200000000 /dev/zero; touch "${marker}"`,
    cwd: d, timeoutMs: null, graceMs: 1_000, maxOutputBytes: 1024, logPath: fifo,
  });
  const child = spawn(process.execPath, [runner, arg], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.resume();

  await new Promise((resolve) => setTimeout(resolve, 2_000));   // 仍在挂住的窗口里
  const finishedWhileStalled = existsSync(marker);

  await new Promise((resolve) => child.on("close", resolve));
  reader.kill();
  rmSync(d, { recursive: true, force: true });

  assert.equal(finishedWhileStalled, false,
    "日志写不动时子进程照样跑完了 —— 说明输出被整个吞进了缓冲，没有背压");
});
