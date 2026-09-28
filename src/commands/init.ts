// src/commands/init.ts
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { initLedger } from "../format/init.ts";
import { assertSupportedVersionIfPresent } from "../format/discover.ts";
import { upsertProtocol } from "../format/agents-md.ts";
import { EXIT, CliError } from "../exit.ts";
import type { InitReport } from "../output/dto/init.ts";
import { AGENTS, runSetup } from "./setup.ts";

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

/**
 * `--setup` 的值：可重复、可逗号分隔，去空白、去重、保持首次出现的顺序。未知的 agent 在任何写入之前报错（tp-jyvt6i）。
 */
export function parseSetupAgents(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    for (const raw of v.split(",")) {
      const a = raw.trim();
      if (a === "") continue;
      if (!(AGENTS as readonly string[]).includes(a)) {
        throw new CliError(EXIT.usage, `Unknown agent ${JSON.stringify(a)} for --setup; supported: ${AGENTS.join(", ")}. Nothing was written.`);
      }
      if (!out.includes(a)) out.push(a);
    }
  }
  return out;
}

export function runInit(opts: { directory: string; prefix: string; setup?: readonly string[] }): InitReport {
  // 校验在任何写入之前：一个被拒绝的命令不该有副作用。
  const setupAgents = opts.setup === undefined ? undefined : parseSetupAgents(opts.setup);
  if (!PREFIX_RE.test(opts.prefix)) {
    throw new CliError(
      EXIT.usage,
      `Invalid id_prefix ${JSON.stringify(opts.prefix)}. It must match ${PREFIX_RE.source}: ` +
        `a lowercase letter followed by up to seven lowercase letters or digits (spec §3).`,
    );
  }
  const root = resolveRoot(opts.directory);
  // 版本闸门必须在**任何**写入之前。spec §9：读者 MUST 拒绝写入版本高于自己的账本；
  // FR-Q2 把它定为退出码 4。init 不走 discoverLedger（它的职责是账本不存在时创建），
  // 所以这里单独施加——否则会在一个自己读不懂的账本上继续写。
  assertSupportedVersionIfPresent(join(root, ".todopi"));
  const { created, kept } = initLedger(root, { prefix: opts.prefix });
  // FR-Q5：写 AGENTS.md，不存在则创建。MUST NOT 碰 CLAUDE.md——让 Claude Code
  // 读到协议是 FR-Q5a 的事，属于 setup claude（F14）；`--setup claude` 正是在这之后调用它。
  const agents = upsertProtocol(join(root, "AGENTS.md"));
  if (setupAgents === undefined) return { root, created, kept, agents };
  // 等价于 init 之后逐个 setup（项目级）。某一家被拒（例如它的 settings 是符号链接）就照 setup 的错误退出：
  // 账本与前面几家已经写好，重跑是安全的（init 与 setup 都幂等）。
  const setup = setupAgents.map((agent) => runSetup({ directory: root, agent }));
  return { root, created, kept, agents, setup };
}
