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

/**
 * `git config user.name` 的**原始值**；没配置或不在仓库里返回 null。
 *
 * 用 `-z`：git 以 NUL 结尾输出，值里的空白原样保留。不能用 .trim()——
 * 它会连值本身的首尾空白一起吃掉，而 spec §5.4 要求把空白串换成 `-`。
 * 实测 user.name=" Sean Dong " 按规格应得到 `-sean-dong-`，trim 之后是
 * `sean-dong`；纯空白应得到 `-`，trim 之后变成空值而回退到 unknown@host。
 * 两者都会让我们和按规格实现的第三方对同一份配置得出不同的身份。
 *
 * 不做规范化：那是 spec §5.4 的纯函数，属于 domain。这一层只取回外部事实。
 */
export function gitUserName(root: string): string | null {
  try {
    const out = execFileSync("git", ["config", "-z", "--get", "user.name"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    // -z 的输出是 `<值>\0`；只去掉那个分隔符，值本身一个字符都不动
    const value = out.endsWith("\0") ? out.slice(0, -1) : out;
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

/**
 * 当前 HEAD 的短 sha（7 位）；不在 git 仓库里、或仓库还没有任何提交时返回 null。
 *
 * spec §5.3.3 的 `done` 行带 `commit=<sha7>`。**拿不到就不写这个 key**，
 * 不写 `commit=unknown`——一个假的 sha 比没有更坏：读日志的人会拿它去 checkout。
 */
export function gitHead(root: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}

/**
 * 工作区是否有未提交的改动；不在 git 仓库里返回 null。
 *
 * 用 `--porcelain`：它的输出是给程序读的，格式跨版本稳定。
 * 含未跟踪文件——`done` 记的 `dirty` 要回答「这次完成对应的树干不干净」，
 * 一个没加进 git 的新文件同样让它不干净。
 */
export function gitDirty(root: string): boolean | null {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() !== "";
  } catch {
    return null;
  }
}
