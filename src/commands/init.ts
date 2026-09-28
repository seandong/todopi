// src/commands/init.ts
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { initLedger } from "../format/init.ts";
import { assertSupportedVersionIfPresent } from "../format/discover.ts";
import { upsertProtocol } from "../format/agents-md.ts";
import { EXIT, CliError } from "../exit.ts";
import type { InitReport } from "../output/dto/init.ts";
import type { SetupReport } from "../output/dto/setup.ts";
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
  // 给了 --setup 却一个都没有（`--setup ' , '`）：显式要求接入却什么都不装，不能静默退化成普通 init（评审）
  if (values.length > 0 && out.length === 0) {
    throw new CliError(EXIT.usage, `--setup needs at least one agent: ${AGENTS.join(", ")}. Nothing was written.`);
  }
  return out;
}

/** 能直接复制进 shell 的路径：只含安全字符就原样，否则单引号包起来 */
function shellQuote(p: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;
}

/**
 * 某一家 setup 失败时的错误：账本与前面几家已经写好了，说清楚写了什么、哪一家失败、还差哪几家、修好之后跑什么（评审一、二轮）。
 * 出错时 stdout 为空（docs/json.md 的约定），所以这些都在错误消息里。
 * 失败的那一家可能在抛错之前已经写了它的一部分文件（例如 settings.json 写了、CLAUDE.md 被拒）：这里不断言「别的都没动」，
 * 只说它可能写了一部分、重跑是安全的（setup 幂等）。恢复命令带 `-C <root>`：用 -C 从项目外跑的人照抄也能跑。
 */
function partialFailure(root: string, init: { created: string[]; agents: InitReport["agents"] }, done: SetupReport[],
  failed: string, remaining: string[], why: string): string {
  const written = [
    ...init.created,
    ...(init.agents === "unchanged" ? [] : ["AGENTS.md"]),
    ...done.flatMap((r) => r.files.filter((f) => f.status !== "unchanged").map((f) => relative(root, f.path))),
  ];
  const where = shellQuote(root);
  return [
    `setup ${failed} failed: ${why}`,
    ...(written.length === 0 ? [] : [`Already written: ${written.join(", ")}.`]),
    `setup ${failed} may have written some of its own files before it failed; running it again is safe.`,
    `Not set up yet: ${remaining.join(", ")}. Fix the problem above, then run: ${remaining.map((a) => `todopi -C ${where} setup ${a}`).join(" && ")}`,
  ].join("\n");
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
  const setup: SetupReport[] = [];
  for (const [i, agent] of setupAgents.entries()) {
    try {
      setup.push(runSetup({ directory: root, agent }));
    } catch (err) {
      // 不只是 CliError：文件系统的错误（悬空的符号链接 ENOENT 之类）同样发生在账本与前几家写好之后（评审二轮）
      const code = err instanceof CliError ? err.code : EXIT.usage;
      const why = err instanceof Error ? err.message : String(err);
      throw new CliError(code, partialFailure(root, { created, agents }, setup, agent, setupAgents.slice(i), why));
    }
  }
  return { root, created, kept, agents, setup };
}
