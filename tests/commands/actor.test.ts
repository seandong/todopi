import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { currentActor } from "../../src/commands/actor.ts";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runLs } from "../../src/commands/ls.ts";
import { EXIT } from "../../src/exit.ts";

// 把全局与系统级 git 配置隔离掉：本机若配了 user.name，「未配置」那几个
// 用例会读到它而不是走回退，测试结果取决于跑它的人（实测如此）。
// node --test 每个文件一个进程，改这里不会影响别的测试文件。
process.env["GIT_CONFIG_GLOBAL"] = "/dev/null";
process.env["GIT_CONFIG_SYSTEM"] = "/dev/null";
process.env["GIT_CONFIG_NOSYSTEM"] = "1";

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
