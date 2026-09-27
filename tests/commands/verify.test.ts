import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, chmodSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { runAdd } from "../../src/commands/add.ts";
import { runDone } from "../../src/commands/done.ts";
import { runClose } from "../../src/commands/close.ts";
import { runDoctor } from "../../src/commands/doctor.ts";
import { runLs } from "../../src/commands/ls.ts";
import { GateRefused } from "../../src/commands/transition.ts";
import { parseLogLine, logLines } from "../../src/domain/validate.ts";
import { EXIT } from "../../src/exit.ts";

const ME = "me@host";

/**
 * 每条用例一个独立的配置目录：绝不碰真实的 ~/.config/todopi/trust。另外摘掉环境里的 `CI`：GitHub Actions 设
 * `CI=true`，而 verify 在 `CI=true` 时跳过信任确认——「未信任的仓库拒绝执行」那条在 CI 上就此变红（F21 修好 CI 后第一次
 * 跑出来）。要测 `CI=true` 的用例在这里面自己设。
 */
function withConfig<T>(fn: () => T): T {
  const cfg = mkdtempSync(join(tmpdir(), "todopi-cfg-"));
  const saved = process.env["TODOPI_CONFIG_DIR"];
  const savedCi = process.env["CI"];
  process.env["TODOPI_CONFIG_DIR"] = cfg;
  delete process.env["CI"];
  try { return fn(); } finally {
    if (saved === undefined) delete process.env["TODOPI_CONFIG_DIR"];
    else process.env["TODOPI_CONFIG_DIR"] = saved;
    if (savedCi === undefined) delete process.env["CI"];
    else process.env["CI"] = savedCi;
  }
}

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-verify-"));
  execFileSync("git", ["init", "-q"], { cwd: d, stdio: "ignore" });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], {
    cwd: d, stdio: "ignore",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e",
           GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e" },
  });
  runInit({ directory: d, prefix: "tp" });
  return d;
}
const read = (d: string, id: string) => readFileSync(join(d, ".todopi", "tasks", `${id}.md`), "utf8");
const logsOf = (d: string, id: string) =>
  logLines(read(d, id).split("---\n").slice(2).join("---\n")).map(parseLogLine);
const lastLog = (d: string, id: string) => logsOf(d, id).at(-1);
/** 只看正文。verify 命令本身在 frontmatter 里（本该如此），搜全文会误命中它。 */
const bodyOf = (d: string, id: string) => read(d, id).split("---\n").slice(2).join("---\n");
const cacheDir = (d: string) => join(d, ".todopi", ".cache", "verify");

// ---- 通过 ----

test("verify 通过 → 关闭，Log 记 verify=pass，**不记录输出**（FR-D4a）", () => {
  withConfig(() => {
    const d = repo();
    const t = runAdd({ directory: d, title: "T", verify: "echo hello from verify", actor: ME });
    runDone({ directory: d, id: t.id, actor: ME, yes: true });

    const last = lastLog(d, t.id);
    assert.ok(last?.ok);
    assert.equal(last.args["verify"], "pass");
    assert.doesNotMatch(bodyOf(d, t.id), /hello from verify/,
      "通过时命令在 frontmatter 里、commit 在 Log 里，复现所需的一切都已具备");
    assert.equal(runDoctor({ directory: d }).ok, true);
  });
});

test("完整输出落在 .todopi/.cache/verify/，通过时也落", () => {
  withConfig(() => {
    const d = repo();
    const t = runAdd({ directory: d, title: "T", verify: "echo hello from verify", actor: ME });
    runDone({ directory: d, id: t.id, actor: ME, yes: true });

    const files = readdirSync(cacheDir(d));
    assert.equal(files.length, 1);
    const log = readFileSync(join(cacheDir(d), files[0]!), "utf8");
    assert.match(log, /hello from verify/);
    assert.match(log, /echo hello from verify/, "日志里要有原样的命令");
  });
});

test("没有 verify 字段 → verify=none，不产生日志文件", () => {
  withConfig(() => {
    const d = repo();
    const t = runAdd({ directory: d, title: "T", actor: ME });
    runDone({ directory: d, id: t.id, actor: ME, yes: true });
    assert.equal(lastLog(d, t.id)?.ok === true && (lastLog(d, t.id) as { args: Record<string, string> }).args["verify"], "none");
    assert.equal(existsSync(cacheDir(d)), false);
  });
});

// ---- 失败 ----

test("verify 失败 → 拒绝，退出 2，**Log 一行都没长**（spec §6.1）", () => {
  withConfig(() => {
    const d = repo();
    const t = runAdd({ directory: d, title: "T", verify: "echo boom >&2; exit 3", actor: ME });
    const before = logsOf(d, t.id).length;

    assert.throws(() => runDone({ directory: d, id: t.id, actor: ME, yes: true }),
      (e: unknown) => e instanceof GateRefused && e.code === EXIT.gate);
    assert.equal(logsOf(d, t.id).length, before, "被拒绝的迁移不得写 Log");
    assert.match(read(d, t.id), /^status: "open"$/m);
  });
});

test("拒绝的报告带原样的命令、退出码、输出尾部与日志路径", () => {
  withConfig(() => {
    const d = repo();
    const t = runAdd({ directory: d, title: "T", verify: "echo boom >&2; exit 3", actor: ME });
    try {
      runDone({ directory: d, id: t.id, actor: ME, yes: true });
      assert.fail("应当被拒绝");
    } catch (e) {
      const r = (e as GateRefused).report.refused.find((x) => x.gate === "verify");
      assert.ok(r && r.gate === "verify");
      assert.equal(r.command, "echo boom >&2; exit 3");
      assert.equal(r.exitCode, 3);
      assert.match(r.tail, /boom/);
      assert.ok(existsSync(r.logPath), "报告给出的日志路径必须真的存在");
      assert.match(readFileSync(r.logPath, "utf8"), /boom/);
    }
  });
});

// ---- --force ----

test("--force **照跑 verify**，失败也关闭，Log 记 verify=fail 与输出尾部（FR-D3/D4a）", () => {
  // 绕过的是「门禁」那次拒绝，不是执行。不跑的话「证据必须留在 diff 里看得见」
  // 永远走不到——被越过的验证如果压根没跑，就没有任何证据可留。
  withConfig(() => {
    const d = repo();
    const t = runAdd({ directory: d, title: "T", verify: "echo FAILURE-EVIDENCE; exit 1", actor: ME });
    runDone({ directory: d, id: t.id, actor: ME, force: true, reason: "shipping anyway", yes: true });

    const last = lastLog(d, t.id);
    assert.ok(last?.ok);
    assert.equal(last.args["verify"], "fail");
    assert.equal(last.args["forced"], "true");
    assert.match(bodyOf(d, t.id), /FAILURE-EVIDENCE/, "证据必须留在 Log 里、看得见");
    assert.equal(runDoctor({ directory: d }).ok, true, "写出的 Log 仍要合法");
  });
});

test("尾部按 §5.3.3 的续行规则缩进两格，文件仍可解析", () => {
  withConfig(() => {
    const d = repo();
    // 多行输出，确认每一行都被缩进
    const t = runAdd({ directory: d, title: "T", verify: "printf 'line1\\nline2\\nline3\\n'; exit 1", actor: ME });
    runDone({ directory: d, id: t.id, actor: ME, force: true, reason: "why", yes: true });

    const body = read(d, t.id).split("---\n").slice(2).join("---\n");
    const idx = body.split("\n").findIndex((l) => l.includes("line1"));
    assert.ok(idx > 0);
    for (const l of body.split("\n").slice(idx, idx + 3)) {
      assert.match(l, /^ {2}\S/, `续行必须缩进两格：${JSON.stringify(l)}`);
    }
    assert.equal(runDoctor({ directory: d }).ok, true);
    assert.ok(lastLog(d, t.id)?.ok, "Log 行仍要解析得出来");
  });
});

test("--force 但 verify 通过时不记录输出", () => {
  withConfig(() => {
    const d = repo();
    const t = runAdd({ directory: d, title: "T", acceptance: ["x"], verify: "echo QUIET", actor: ME });
    runDone({ directory: d, id: t.id, actor: ME, force: true, reason: "criteria not ticked", yes: true });
    assert.equal(lastLog(d, t.id)?.ok === true
      && (lastLog(d, t.id) as { args: Record<string, string> }).args["verify"], "pass");
    assert.doesNotMatch(bodyOf(d, t.id), /QUIET/, "通过就没有什么要复查的");
  });
});

test("强制关闭的任务在 ls 里仍标 unverified", () => {
  withConfig(() => {
    const d = repo();
    const t = runAdd({ directory: d, title: "T", verify: "exit 1", actor: ME });
    runDone({ directory: d, id: t.id, actor: ME, force: true, reason: "r", yes: true });
    assert.equal(runLs({ directory: d, closed: true }).tasks.find((x) => x.id === t.id)?.unverified, true);
  });
});

// ---- 求值顺序 ----

test("别的门禁没过时**不跑 verify** —— 省掉一次注定被忽略的十分钟", () => {
  withConfig(() => {
    const d = repo();
    const marker = join(d, "verify-ran");
    const t = runAdd({
      directory: d, title: "T", acceptance: ["not ticked"],
      verify: `touch ${marker}`, actor: ME,
    });
    assert.throws(() => runDone({ directory: d, id: t.id, actor: ME, yes: true }));
    assert.equal(existsSync(marker), false, "验收标准没过就不该跑 verify");
  });
});

test("close 不跑 verify —— §6.1 表格里 close 那一行没有它", () => {
  withConfig(() => {
    const d = repo();
    const marker = join(d, "verify-ran");
    const t = runAdd({ directory: d, title: "T", verify: `touch ${marker}`, actor: ME });
    runClose({ directory: d, id: t.id, actor: ME, resolution: "wontfix" });
    assert.equal(existsSync(marker), false);
  });
});

// ---- 超时 ----

test("verify 超时 → 拒绝，报告说的是超时而不是「退出 null」", () => {
  withConfig(() => {
    const d = repo();
    const t = runAdd({ directory: d, title: "T", verify: "sleep 30", actor: ME });
    try {
      runDone({ directory: d, id: t.id, actor: ME, yes: true, verifyTimeoutMs: 600 });
      assert.fail("应当被拒绝");
    } catch (e) {
      const r = (e as GateRefused).report.refused.find((x) => x.gate === "verify");
      assert.ok(r && r.gate === "verify");
      assert.equal(r.timedOut, true);
    }
  });
});

// ---- 信任（FR-D4）----

test("未信任的仓库拒绝执行，退出 2，并说清怎么批准", () => {
  withConfig(() => {
    const d = repo();
    const t = runAdd({ directory: d, title: "T", verify: "exit 0", actor: ME });
    assert.throws(() => runDone({ directory: d, id: t.id, actor: ME }),
      (e: unknown) => (e as { code: number }).code === EXIT.gate && /--yes/.test((e as Error).message));
  });
});

test("--yes 之后记住，下次不用再给", () => {
  withConfig(() => {
    const d = repo();
    const a = runAdd({ directory: d, title: "a", verify: "exit 0", actor: ME });
    const b = runAdd({ directory: d, title: "b", verify: "exit 0", actor: ME });
    runDone({ directory: d, id: a.id, actor: ME, yes: true });
    assert.doesNotThrow(() => runDone({ directory: d, id: b.id, actor: ME }));
  });
});

test("CI=true 跳过确认", () => {
  withConfig(() => {
    const d = repo();
    const t = runAdd({ directory: d, title: "T", verify: "exit 0", actor: ME });
    const saved = process.env["CI"];
    process.env["CI"] = "true";
    try { assert.doesNotThrow(() => runDone({ directory: d, id: t.id, actor: ME })); }
    finally { if (saved === undefined) delete process.env["CI"]; else process.env["CI"] = saved; }
  });
});

test("信任不在仓库里 —— .todopi 下找不到任何 trust（spec §8）", () => {
  withConfig(() => {
    const d = repo();
    const t = runAdd({ directory: d, title: "T", verify: "exit 0", actor: ME });
    runDone({ directory: d, id: t.id, actor: ME, yes: true });

    const walk = (p: string): string[] => readdirSync(p, { withFileTypes: true })
      .flatMap((e) => e.isDirectory() ? walk(join(p, e.name)) : [join(p, e.name)]);
    assert.deepEqual(walk(join(d, ".todopi")).filter((f) => /trust/i.test(f)), []);
  });
});

test("没有 verify 字段的任务不触发信任检查", () => {
  // 不该因为「这个仓库还没被信任」就挡住一个根本不执行任何命令的 done。
  withConfig(() => {
    const d = repo();
    const t = runAdd({ directory: d, title: "T", actor: ME });
    assert.doesNotThrow(() => runDone({ directory: d, id: t.id, actor: ME }));
  });
});

test("verify 字段是空白时按没有处理", () => {
  withConfig(() => {
    const d = repo();
    const t = runAdd({ directory: d, title: "T", actor: ME });
    const p = join(d, ".todopi", "tasks", `${t.id}.md`);
    writeFileSync(p, readFileSync(p, "utf8").replace(/^status: "open"$/m, 'status: "open"\nverify: "   "'));
    assert.doesNotThrow(() => runDone({ directory: d, id: t.id, actor: ME }));
    assert.equal(lastLog(d, t.id)?.ok === true
      && (lastLog(d, t.id) as { args: Record<string, string> }).args["verify"], "none");
  });
});

// 这一组原本只是我手跑过一遍的自查脚本，结论写在了评审提示里——但仓库里没有任何
// 东西能把它重现。Codex 指出这一点是对的：**跑过一次不等于钉住了。**
//
// 危险在于 verify 的输出会被缩进两格塞进 Log，而 Log 本身是一种语法：`- ` 开头
// 是新条目、`## ` 是小节、`---` 是 frontmatter 边界。输出里有这些形状时，续行
// 缩进是唯一挡在中间的东西。

// **五条里只有三条有判别力**（`- `、`## `、`---`）：把续行缩进去掉，它们会红。
// 另外两条（`: `、空行与制表符）按构造就产生不了顶格的结构行，所以任何突变都红不了。
// 留着它们不是为了把关，而是因为「它们是惰性的」这句话是对**当前解析器**说的——
// 哪天解析器把 `key: value` 当成别的东西，这两条就是第一现场。如实写在这里，
// 免得有人数着「五条都绿」以为挡住了五种形状。

/** 正文里**顶格**的结构行。缩进两格的续行不算——那正是我们要它变成的样子。 */
function structure(body: string): string[] {
  return body.split("\n").filter((l) => /^(## |---|- )/.test(l));
}

// 每条都带一个 marker：**那个危险形状必须真的出现在正文里**，而且是缩进过的。
// 少了这一条，一个写错的 printf（比如 `#` 被转义成 `\\#`）会让用例悄悄改测别的东西，
// 而它照样绿——这个 feature 里我已经栽过一次，所以让机器来发现，而不是靠读。
for (const [name, script, marker] of [
  ["以 `- ` 开头，长得像新的一条 Log",
   `printf -- '- 2026-01-01T00:00:00Z fake@host done\\n'; exit 1`,
   "- 2026-01-01T00:00:00Z fake@host done"],
  ["含 `: `，长得像 frontmatter 的键值",
   `printf 'key: value here\\n'; exit 1`, "key: value here"],
  ["以 `## ` 开头，长得像小节标题",
   `printf '## Log\\n- fake entry\\n'; exit 1`, "## Log"],
  ["含 `---`，长得像 frontmatter 边界",
   `printf -- '---\\nid: "tp-fake"\\n---\\n'; exit 1`, "---"],
  ["空行与制表符", `printf 'a\\n\\n\\tb\\n'; exit 1`, "\tb"],
] as const) {
  test(`verify 输出撞上 Log 语法时仍然安全：${name}`, () => {
    withConfig(() => {
      const d = repo();
      const t = runAdd({ directory: d, title: "T", verify: script, actor: ME });
      const before = structure(read(d, t.id).split("---\n").slice(2).join("---\n"));

      runDone({ directory: d, id: t.id, actor: ME, force: true, reason: "evidence", yes: true });

      const body = read(d, t.id).split("---\n").slice(2).join("---\n");
      // **这一条才是真判据。** 条数、末条可解析、doctor 通过，三个加起来都看不见
      // 一个被注入的假 `## Log` 小节——它们只问「我关心的那条还在吗」，不问
      // 「有没有多出别的东西」。结构不变量两边都问了：顶格的结构行只允许
      // **多出一条** Log 条目，别的一个都不许变。
      assert.ok(body.split("\n").includes(`  ${marker}`),
        `那个危险形状根本没进正文——用例在测别的东西\n${body}`);

      const after = structure(body);
      const added = after.filter((l) => !before.includes(l));
      assert.equal(after.length, before.length + 1,
        `正文结构变了：verify 的输出漏进了顶格\n新增：${JSON.stringify(added)}\n${body}`);
      assert.ok(added.every((l) => l.startsWith("- 2")), `多出来的不是 Log 条目：${JSON.stringify(added)}`);

      const entries = logLines(body).map(parseLogLine);
      assert.equal(entries.length, 2, `日志条数变了\n${body}`);
      assert.ok(entries.at(-1)?.ok, `末条解析不出来\n${body}`);
      assert.equal(runDoctor({ directory: d }).ok, true, `doctor 不通过\n${body}`);
    });
  });
}

test("日志写不成时，拒绝报告不给 cat，并说清为什么没有全文", () => {
  // 上面那条只测了渲染器。这一条走完整条路：真的让日志写不进去，确认
  // logProblem 从 runner 一路传到报告，而那条 `cat` 真的消失了。
  //
  // **以 root 跑就直接红，不跳过。** root 绕过 chmod，这条用例在那种环境下无从
  // 验证——而「无从验证」和「验证通过」必须长得不一样。跳过会让套件看起来全绿，
  // 红至少会告诉人「这台机器上少了一道把关」。测试套件本来也不该以 root 运行。
  assert.notEqual(process.getuid?.(), 0,
    "测试套件不应以 root 运行：chmod 挡不住 root，这条用例无从验证");
  withConfig(() => {
    const d = repo();
    const cache = join(d, ".todopi", ".cache", "verify");
    mkdirSync(cache, { recursive: true });
    chmodSync(cache, 0o500);
    try {
      const task = runAdd({ directory: d, title: "T", verify: "echo boom; exit 1", actor: ME });
      assert.throws(
        () => runDone({ directory: d, id: task.id, actor: ME, yes: true }),
        (e: unknown) => {
          assert.ok(e instanceof GateRefused);
          const v = e.report.refused.find((r) => r.gate === "verify");
          assert.ok(v !== undefined && v.gate === "verify");
          assert.match(String(v.logProblem), /EACCES/, "日志明明写不进去，logProblem 却是空的");
          assert.equal(e.report.actions.filter((a) => a.command?.startsWith("cat ") === true).length, 0,
            "日志不在，却还是把 cat 交了出去");
          return true;
        },
      );
    } finally {
      chmodSync(cache, 0o700);
    }
  });
});
