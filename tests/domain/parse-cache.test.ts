import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, realpathSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sectionLines, parseAcceptance } from "../../src/domain/acceptance.ts";
import { gitCommonDir } from "../../src/fs/git.ts";

/**
 * F36 的两个缓存对调用方透明：解析结构记住上一段正文，交替、重复地问不同正文，答案都与各自单独问时相同；
 * gitCommonDir 只缓存找到了的结果——先在非 git 目录里问、再 git init，照样找得到。
 */
test("正文解析的缓存：交替与重复地问，结果与单独问时相同", () => {
  const a = "## Acceptance Criteria\n\n- [ ] one\n\n## Log\n\n- 2026-01-01T00:00:00Z x created\n";
  const b = "## Acceptance Criteria\n\n- [x] two\n- [ ] three\n\n## Log\n\n```\n- 2026-01-01T00:00:00Z fake done\n```\n";
  // 期望值写死，不从被测函数自己算（第一版用 want(a) 当期望，缓存坏了期望值跟着坏，照样通过——变异测试抓到的假绿）
  const check = (body: string) => {
    const ac = parseAcceptance(body).map((c) => `${c.checked ? "x" : " "}${c.text}`);
    const log = sectionLines(body, "## Log").filter((l) => !l.fenced && l.text.startsWith("- ")).map((l) => l.text);
    if (body === a) {
      assert.deepEqual(ac, [" one"]);
      assert.deepEqual(log, ["- 2026-01-01T00:00:00Z x created"]);
    } else {
      assert.deepEqual(ac, ["xtwo", " three"]);
      assert.deepEqual(log, [], "围栏里的那行不是 Log 条目");
    }
  };
  for (const body of [a, b, b, a, a, b, a]) check(body);
  // 与 CRLF 版本不混：键是原文
  const crlf = a.replace(/\n/g, "\r\n");
  assert.equal(JSON.stringify(parseAcceptance(crlf).map((c) => c.text)), JSON.stringify(["one"]));
  check(a);
});

test("gitCommonDir 只缓存找到了的：先查非 git 目录得 null，git init 之后能找到", () => {
  const d = mkdtempSync(join(tmpdir(), "todopi-gitcache-"));
  assert.equal(gitCommonDir(d), null);
  execFileSync("git", ["init", "-q"], { cwd: d });
  const found = gitCommonDir(d);
  assert.ok(found !== null && found.endsWith(".git"));
  assert.equal(gitCommonDir(d), found);
});

test("gitCommonDir 的缓存跟着 .git 的身份走：主仓库挪走、worktree repair 之后，同一进程里拿到的是新位置（Codex 评审）", () => {
  // realpath：macOS 的临时目录经 /var → /private/var 的链接，git 报的是真实路径
  const base = realpathSync(mkdtempSync(join(tmpdir(), "todopi-gitwt-")));
  const main = join(base, "main"), wt = join(base, "wt");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e" } });
  execFileSync("git", ["init", "-q", main]);
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  git(main, "worktree", "add", "-q", wt);
  const before = gitCommonDir(wt);
  assert.ok(before !== null && before.startsWith(join(base, "main")), before ?? "null");
  const moved = join(base, "main-moved");
  renameSync(main, moved);
  git(moved, "worktree", "repair", wt);
  const after = gitCommonDir(wt);
  assert.ok(after !== null && after.startsWith(moved), `after repair: ${after}`);
});
