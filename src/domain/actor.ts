// src/domain/actor.ts
import { ACTOR_RE } from "./types.ts";
// FR-C6 的**读宽松**那一半。写入端的严格匹配在 F05/F06。

/**
 * 这个任务算不算「我的」。
 *
 * FR-C6：展示类命令（ls --mine、prime、handoff 的报告）把 assignee 等于当前
 * 解析出的 actor **或**以 `@<本机 host>` 结尾的任务都算作我的。
 *
 * 宽松的理由是具体的：actor 是 agent 级的（claude-code@mbp），而人在终端里
 * 是裸名（sean）。严格匹配会让人跑 `ls --mine` 看不到自己 agent 正在做的事——
 * 而那正是这个命令存在的意义。用 host 后缀做判据不需要任何配置，
 * 也不需要保存一份 actor 清单。
 *
 * 匹配的是 `@host` 后缀而不是子串：`claude-code@notmbp` 不是 `@mbp`。
 *
 * 空值只在一处处理。空的 assignee 提前返回之后，后面的 assignee 必然非空，
 * 于是 `opts.actor` 为空或缺失时不可能相等——不需要再给它单独加守卫。
 * 这是变异测试逼出来的：原先两处守卫各自都能挡住 `("", "")`，
 * 互为冗余，于是谁都杀不掉对方的变异体。
 */
export function isMine(assignee: unknown, opts: { actor?: string; host: string }): boolean {
  if (typeof assignee !== "string" || assignee === "") return false;
  if (assignee === opts.actor) return true;
  return assignee.endsWith(`@${opts.host}`);
}

/**
 * spec §5.4 的规范化。**步骤有序**，顺序不是实现细节：
 * 小写 → 把连续空白换成 `-` → 删掉 `[a-z0-9_.@+-]` 之外的字符 → 截断到 64 → 空则拒绝。
 *
 * 先换空白再删字符是关键：反过来的话 "Sean Dong" 会变成 seandong 而不是
 * sean-dong，因为空格本身就在待删的字符集里。
 *
 * 返回 null 表示「规范化之后什么都不剩」，调用方据此走回退。
 */
export function normalizeActor(raw: string): string | null {
  const out = raw
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_.@+-]/g, "")
    .slice(0, 64);
  return out === "" ? null : out;
}

/**
 * FR-C4 第三级：各家 agent 给自己**工具子进程**设的环境变量（2026-09-28 按一手资料核实，F22；证据见 DECISIONS D043）。
 *
 * 只认运行时自己设的变量，不认用户配置类的（`CODEX_HOME` 在任何装了 codex 的 shell 里都有，那不是「正在运行的是 codex」的证据）。
 *
 * agent 会嵌套（本仓库就是 Claude Code 调 Codex），内层的环境会继承外层的变量，光看环境分不出哪层在跑——所以不止一个信号在时不推断
 * （见 agentFromEnv）。
 */
export const AGENT_SIGNALS: readonly { agent: string; env: string; value?: string }[] = [
  { agent: "codex", env: "CODEX_THREAD_ID" },
  { agent: "gemini", env: "GEMINI_CLI", value: "1" },
  { agent: "opencode", env: "OPENCODE", value: "1" },
  { agent: "pi", env: "PI_SESSION_ID" },
  { agent: "cursor", env: "CURSOR_AGENT", value: "1" },
  { agent: "claude-code", env: "CLAUDECODE", value: "1" },
];

/** `--agent` / `TODOPI_AGENT` 接受的名字。 */
export const AGENT_NAMES: readonly string[] = AGENT_SIGNALS.map((s) => s.agent);

/**
 * 认出正在运行的 agent：**恰好一个**信号在时才算；一个都没有、或不止一个（嵌套：内层继承了外层的变量），返回 undefined。
 *
 * 嵌套时光看环境分不出哪一层在跑——Codex 里起的 Gemini，环境里 CODEX_THREAD_ID 与 GEMINI_CLI 都在（Codex 评审）。猜错的代价
 * 是任务记到别的 agent 名下、写入端的严格匹配拒绝它（D014 的原则：少一级回退好过猜错）。嵌套里跑的 agent 用 `--agent`、
 * `TODOPI_AGENT` 或 `TODOPI_ACTOR` 说清楚；setup 写出的钩子本来就带 `--agent`。
 */
export function agentFromEnv(env: Record<string, string | undefined>): string | undefined {
  const found = AGENT_SIGNALS.filter((s) => {
    const v = env[s.env];
    return v !== undefined && v !== "" && (s.value === undefined || v === s.value);
  });
  return found.length === 1 ? found[0]!.agent : undefined;
}

export type ActorFacts = {
  /** --as 的值 */
  explicit?: string;
  /** TODOPI_ACTOR 的值 */
  env?: string;
  /**
   * 正在运行的 agent：`--agent` / `TODOPI_AGENT` 给的（setup 写进钩子的就是它——钩子子进程里不一定有下面那些信号），
   * 没给就是 agentFromEnv 从环境认出来的
   */
  agent?: string;
  /** git config user.name 的值 */
  gitName?: string;
  /** 本机主机名 */
  host: string;
  /** 人手输入的身份不合法时怎么办。默认抛错由调用方转成退出码。 */
  onInvalid?: (source: string, value: string) => string;
};

/**
 * FR-C4 的解析链：`--as` > `TODOPI_ACTOR` > agent（`<agent>@<host>`）> `git config user.name`。
 *
 * actor 标识的是工作者而不是会话：同一台机器上同一个 agent 跨会话不变，所以是 agent 名加主机名，不带会话 id。
 *
 * `--as` 与 `TODOPI_ACTOR` 是人手输入的，**不规范化**：悄悄改掉会让人纳闷
 * 自己的过滤器为什么不匹配，报错则当场说清楚。只有 `git config user.name`
 * 属于 spec §5.4 说的「取自外部来源的值」，需要规范化；agent 那一级的主机名同理（含冒号或空白时规范化）。
 */
export function resolveActor(facts: ActorFacts): string {
  const onInvalid = facts.onInvalid ?? ((source, value) => {
    throw new Error(`${source} is not a valid actor: ${JSON.stringify(value)} (spec §5.4: 1-64 characters, no whitespace or colon)`);
  });
  for (const [source, value] of [["--as", facts.explicit], ["TODOPI_ACTOR", facts.env]] as const) {
    if (value === undefined || value === "") continue;
    return ACTOR_RE.test(value) ? value : onInvalid(source, value);
  }
  if (facts.agent !== undefined && facts.agent !== "") {
    const raw = `${facts.agent}@${facts.host}`;
    const actor = ACTOR_RE.test(raw) ? raw : normalizeActor(raw);
    if (actor !== null) return actor;
  }
  if (facts.gitName !== undefined && facts.gitName !== "") {
    const normalized = normalizeActor(facts.gitName);
    if (normalized !== null) return normalized;
  }
  // 带上 host 而不是光秃秃的 unknown：@host 的宽松匹配因此仍然成立，
  // 而 unknown 这个前缀一眼就看得出是占位符
  return `unknown@${facts.host}`;
}
