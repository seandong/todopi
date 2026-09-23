import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../../src/exec/run.ts";

const dir = () => mkdtempSync(join(tmpdir(), "todopi-run-"));

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

test("超时终止**整棵进程树** —— 断言的是孙进程的 pid", () => {
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
  const r = runCommand(`bash -c 'echo $$ > ${pidFile}; sleep 30' & sleep 0.5; exit 0`,
    { cwd: d, timeoutMs: 10_000 });
  assert.equal(r.timedOut, false);
  assert.equal(r.code, 0);

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
  assert.equal(runCommand(`echo "a b" | tr ' ' '-'`, { cwd: d }).stdout.trim(), "a-b");
  assert.equal(runCommand(`true && echo yes`, { cwd: d }).stdout.trim(), "yes");
  assert.equal(runCommand(`echo 'single $NOTEXPANDED'`, { cwd: d }).stdout.trim(), "single $NOTEXPANDED");
});

test("stdout 与 stderr 分开捕获", () => {
  const d = dir();
  const r = runCommand(`echo out; echo err >&2`, { cwd: d });
  assert.equal(r.stdout.trim(), "out");
  assert.equal(r.stderr.trim(), "err");
});

test("cwd 是给定的目录", () => {
  const d = dir();
  writeFileSync(join(d, "marker"), "x");
  assert.match(runCommand("ls", { cwd: d }).stdout, /marker/);
});

test("输出超过上限时截断并置 truncated", () => {
  // pnpm test 能吐几十 MB，全缓存在内存里不合适。
  const d = dir();
  const r = runCommand(`head -c 3000000 /dev/zero | tr '\\0' 'x'`, { cwd: d, maxOutputBytes: 1024 });
  assert.equal(r.truncated, true);
  assert.ok(r.stdout.length <= 1024 + 200, `截断没生效，长度 ${r.stdout.length}`);
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
