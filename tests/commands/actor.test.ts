import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { currentActor, currentAgent } from "../../src/commands/actor.ts";
import { AGENT_SIGNALS } from "../../src/domain/actor.ts";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runLs } from "../../src/commands/ls.ts";
import { EXIT } from "../../src/exit.ts";

// 把全局与系统级 git 配置隔离掉：本机若配了 user.name，「未配置」那几个
// 用例会读到它而不是走回退，测试结果取决于跑它的人（实测如此）。
//
// 作用域的准确说法：`node --test` 默认每个文件一个进程，所以这几行不会影响
// 别的测试文件；但加上 `--experimental-test-isolation=none` 之后会泄漏出去
// （Codex 实测）。harness 用的是默认模式。若将来要同进程跑，这里得改成
// 存旧值—跑—还原。`/dev/null` 在 Windows 上也成立：Git for Windows 把它映射到 nul。
process.env["GIT_CONFIG_GLOBAL"] = "/dev/null";
process.env["GIT_CONFIG_SYSTEM"] = "/dev/null";
process.env["GIT_CONFIG_NOSYSTEM"] = "1";
// 同理清掉 agent 的环境信号：本仓库的测试常由 agent 跑（Claude Code 里有 CLAUDECODE=1），不清掉的话「回退到 git
// user.name」的用例会被 agent 推断抢先，结果取决于是谁在跑（F22 实测）。要测推断的用例自己设。
for (const v of ["CLAUDECODE", "CODEX_THREAD_ID", "GEMINI_CLI", "OPENCODE", "PI_SESSION_ID", "CURSOR_AGENT", "TODOPI_AGENT"]) delete process.env[v];

/**
 * 从**真实的 git config 入口**出发，而不是只测 normalizeActor。
 *
 * 这一整个文件是 Codex 第二轮评审的产物：normalizeActor 的纯函数用例当时
 * 全绿，坏的是取值那一层（`.trim()` 吃掉了值本身的首尾空白）。凡是
 * 「外部取值 → 纯函数处理」的链条，用例必须从真实入口走一遍，
 * 否则只验证了链条里没坏的那一半。
 */
function gitRepo(names: string[] = []): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-actor-"));
  execFileSync("git", ["init", "-q"], { cwd: d, stdio: "ignore" });
  for (const n of names) execFileSync("git", ["config", "--add", "user.name", n], { cwd: d, stdio: "ignore" });
  runInit({ directory: d, prefix: "tp" });
  return d;
}

/** TODOPI_ACTOR 必须清掉，否则本机环境会盖过 git config 这一级。 */
function withoutEnvActor<T>(fn: () => T): T {
  const saved = process.env["TODOPI_ACTOR"];
  delete process.env["TODOPI_ACTOR"];
  try { return fn(); } finally { if (saved !== undefined) process.env["TODOPI_ACTOR"] = saved; }
}

const cases: Array<[string, string[], string]> = [
  ["首尾空白按 §5.4 换成 -", [" Sean Dong "], "-sean-dong-"],
  ["纯空白得到 -，不是回退", ["   "], "-"],
  ["普通值不受影响", ["Sean Dong"], "sean-dong"],
  ["已经合法的值原样小写", ["seandong"], "seandong"],
  ["未配置时回退", [], `unknown@${hostname()}`],
  ["多次配置取最后一个", ["First Name", " Last Name "], "-last-name-"],
  ["值里含换行", ["Sean\nDong"], "sean-dong"],
];

for (const [name, names, expected] of cases) {
  test(`git config user.name：${name}`, () => {
    withoutEnvActor(() => {
      const d = gitRepo(names);
      assert.equal(currentActor(d), expected);

      // 真的写进了 Log 吗——解析出来和写下去的必须是同一个
      const t = runAdd({ directory: d, title: "identity probe" });
      const raw = readFileSync(join(d, ".todopi", "tasks", `${t.id}.md`), "utf8");
      assert.ok(raw.includes(` ${expected} created`), `Log 里的 actor 不是 ${expected}：\n${raw}`);

      // ls --mine 认得出同一个身份吗
      const p = join(d, ".todopi", "tasks", `${t.id}.md`);
      writeFileSync(p, raw.replace(/^status: "open"$/m, `status: "in_progress"\nassignee: ${JSON.stringify(expected)}`));
      assert.deepEqual(runLs({ directory: d, mine: true }).tasks.map((x) => x.id), [t.id],
        "写入端与查询端必须解析出同一个身份");
    });
  });
}

test("TODOPI_ACTOR 盖过 git config", () => {
  const d = gitRepo(["Sean Dong"]);
  const saved = process.env["TODOPI_ACTOR"];
  process.env["TODOPI_ACTOR"] = "codex@ci";
  try { assert.equal(currentActor(d), "codex@ci"); }
  finally { if (saved === undefined) delete process.env["TODOPI_ACTOR"]; else process.env["TODOPI_ACTOR"] = saved; }
});

test("--as 盖过一切", () => {
  const d = gitRepo(["Sean Dong"]);
  assert.equal(currentActor(d, "claude-code@mbp"), "claude-code@mbp");
});

test("非法的人手输入退出 1，不被悄悄规范化", () => {
  const d = gitRepo(["Sean Dong"]);
  assert.throws(() => currentActor(d, "bad actor"),
    (e: unknown) => (e as { code: number }).code === EXIT.usage);
});

test("不在 git 仓库里时回退，不抛错", () => {
  withoutEnvActor(() => {
    const d = mkdtempSync(join(tmpdir(), "todopi-nogit-"));
    runInit({ directory: d, prefix: "tp" });
    assert.equal(currentActor(d), `unknown@${hostname()}`);
  });
});

/** 在一组环境变量下跑，跑完还原。 */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test("清理生效：测试进程里没有 agent 信号（否则上面的回退用例测的不是回退）", () => {
  for (const s of AGENT_SIGNALS) assert.equal(process.env[s.env], undefined, s.env);
});

test("agent 环境推断从真实入口走：CODEX_THREAD_ID → codex@<host>，盖过 git user.name；TODOPI_ACTOR 仍盖过它（F22）", () => {
  const d = gitRepo(["Human"]);
  withEnv({ TODOPI_ACTOR: undefined, CODEX_THREAD_ID: "t1" }, () => {
    assert.equal(currentActor(d), `codex@${hostname()}`);
  });
  withEnv({ TODOPI_ACTOR: "boss", CODEX_THREAD_ID: "t1" }, () => {
    assert.equal(currentActor(d), "boss");
  });
  withEnv({ TODOPI_ACTOR: undefined }, () => assert.equal(currentActor(d), "human"));
});

test("--agent / TODOPI_AGENT 显式给的盖过环境信号；名字不认识就退出 1（F22）", () => {
  withEnv({ TODOPI_AGENT: "pi", CLAUDECODE: "1" }, () => assert.equal(currentAgent(), "pi"));
  withEnv({ TODOPI_AGENT: undefined, CLAUDECODE: "1" }, () => assert.equal(currentAgent(), "claude-code"));
  withEnv({ TODOPI_AGENT: "claude" }, () => {
    assert.throws(() => currentAgent(), (e: unknown) => (e as { code: number }).code === EXIT.usage && /claude-code/.test((e as Error).message));
  });
});
