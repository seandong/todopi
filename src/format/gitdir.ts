// src/format/gitdir.ts
// git 公共目录的推导。租约目录与锁路径都靠它，抽出来是为了两者不会各自判断
// 「在不在 git 里」——一旦判断错开，锁和租约会落在不同的地方，互不可见。

import { execFileSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";

/**
 * 仓库的 git 公共目录（绝对路径）；不在 git 仓库里返回 null（spec §1.3 允许）。
 *
 * `git rev-parse --git-common-dir` 返回的是**相对路径**（仓库根 `.git`，
 * 子目录 `../.git`），必须相对仓库根解析成绝对路径——实测过，直接当路径用会错。
 * 用「公共目录」而不是 `--git-dir`，是因为 worktree 的 `--git-dir` 各不相同，
 * 而 spec §8 要求同一仓库的所有 worktree 共用一套租约。
 */
export function gitCommonDir(root: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out === "") return null;
    return isAbsolute(out) ? out : resolve(root, out);
  } catch {
    return null;
  }
}
