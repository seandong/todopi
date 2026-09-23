// src/exec/trust.ts
// FR-D4 的按仓库信任。与 fs/ 同级：只 import node:*，不认识 todopi 的格式。

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * 信任文件的位置。
 *
 * **绝不在 `.todopi/` 里。** spec §8 说得很重：随仓库一起传播的信任记录等于让
 * 仓库为自己背书，那正是「要不要执行这条命令」这个问题存在的理由。
 *
 * 优先级：`TODOPI_CONFIG_DIR` > `XDG_CONFIG_HOME` > `~/.config`。
 * 第一个是给测试用的——用例必须有办法不碰真实的 `~/.config/todopi/trust`，
 * 否则跑一遍测试就会悄悄改掉使用者机器上的信任清单。
 */
export function trustFilePath(): string {
  const base = process.env["TODOPI_CONFIG_DIR"]
    ?? process.env["XDG_CONFIG_HOME"]
    ?? join(homedir(), ".config");
  return join(base, "todopi", "trust");
}

/**
 * 归一化一个仓库路径。
 *
 * `realpathSync` 之后再比：信任是按路径记的，而软链接的检出不该看起来像另一个
 * 仓库。macOS 上 `/tmp` 与 `/private/tmp` 就是这么一对——本会话已经被它咬过一次。
 * 路径不存在时退回到去掉尾部斜杠的原样，让判断照常进行而不是抛错。
 */
function canonical(repoRoot: string): string {
  const trimmed = repoRoot.replace(/\/+$/, "");
  try {
    return realpathSync(trimmed);
  } catch {
    return trimmed;
  }
}

/** 读出清单。读不懂就当没有——这是用户可以手改的文件。 */
function readList(): string[] {
  const p = trustFilePath();
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
  } catch {
    return [];
  }
}

export function isTrusted(repoRoot: string): boolean {
  const want = canonical(repoRoot);
  return readList().some((line) => canonical(line) === want);
}

/** 记下信任。已经在里面就什么都不做，不产生重复行。 */
export function recordTrust(repoRoot: string): void {
  const want = canonical(repoRoot);
  const current = readList();
  if (current.some((line) => canonical(line) === want)) return;
  const p = trustFilePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, [...current, want].join("\n") + "\n");
}
