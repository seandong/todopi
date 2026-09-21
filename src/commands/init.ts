// src/commands/init.ts
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { initLedger } from "../format/init.ts";
import { upsertProtocol } from "../format/agents-md.ts";
import { EXIT, CliError } from "../exit.ts";
import type { InitReport } from "../output/dto/init.ts";

/** id_prefix 的约束来自 spec §3。 */
const PREFIX_RE = /^[a-z][a-z0-9]{0,7}$/;

/**
 * 决定账本建在哪里。spec §1.1：`.todopi/` 在 git 仓库根（含 .git 的目录）。
 * 不在 git 仓库里时（spec §1.3 允许）用给定目录本身。
 *
 * 这里不调用 git——只看 .git 是否存在。理由是 init 必须能在一个刚 git init
 * 完、还没有任何 commit 的仓库里工作，而那时很多 git 命令的行为并不直观。
 */
export function resolveRoot(startDir: string): string {
  let cur = resolve(startDir);
  for (;;) {
    if (existsSync(join(cur, ".git"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return resolve(startDir);
    cur = parent;
  }
}

export function runInit(opts: { directory: string; prefix: string }): InitReport {
  // 校验在任何写入之前：一个被拒绝的命令不该有副作用。
  if (!PREFIX_RE.test(opts.prefix)) {
    throw new CliError(
      EXIT.usage,
      `id_prefix ${JSON.stringify(opts.prefix)} 不合法。` +
        `它必须匹配 ${PREFIX_RE.source}：小写字母开头，1–8 个小写字母或数字（spec §3）。`,
    );
  }
  const root = resolveRoot(opts.directory);
  const { created, kept } = initLedger(root, { prefix: opts.prefix });
  // FR-Q5：写 AGENTS.md，不存在则创建。MUST NOT 碰 CLAUDE.md——让 Claude Code
  // 读到协议是 FR-Q5a 的事，属于 setup claude（F14）。
  const agents = upsertProtocol(join(root, "AGENTS.md"));
  return { root, created, kept, agents };
}
