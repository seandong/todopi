// src/commands/actor.ts
// 把 FR-C4 解析链需要的外部事实取回来，交给 domain 的纯函数决定结果。
// 读命令与写命令共用这一个入口——两处各写一遍，迟早会对同一个人得出两个身份。

import { hostname } from "node:os";
import { AGENT_NAMES, AGENT_SIGNALS, agentFromEnv, resolveActor } from "../domain/actor.ts";
import { gitUserName } from "../fs/git.ts";
import { EXIT, CliError } from "../exit.ts";

/** 当前身份。`explicit` 是 `--as` 的值。 */
export function currentActor(root: string, explicit?: string): string {
  return resolveActor({
    explicit,
    env: process.env["TODOPI_ACTOR"],
    agent: currentAgent(),
    gitName: gitUserName(root) ?? undefined,
    host: hostname(),
    // 人手输入的身份不合法时，当场说清楚并退出 1，而不是悄悄改掉它
    onInvalid: (source, value) => {
      throw new CliError(EXIT.usage,
        `${source} is not a valid actor: ${JSON.stringify(value)}. ` +
        "An actor is 1-64 characters with no whitespace or colon (spec 5.4).");
    },
  });
}

/**
 * 正在运行的 agent：`--agent` 或 TODOPI_AGENT 显式给的优先，其次按环境信号认（FR-C4 第三级）。
 * 显式给的名字不认识就当场报错——拼错一个名字，任务归属就悄悄错开了。
 */
let agentOption: string | undefined;

/**
 * `--agent` 的值。只在本进程里生效，**不**放进环境：放进环境的话 verify 起的子进程（以及里面再调的 todopi）都会继承它，
 * 哪怕那里跑的是另一个 agent（Codex 评审）。用户自己设的 TODOPI_AGENT 照常继承——那是用户说的。
 */
export function setAgentOption(name: string | undefined): void {
  agentOption = name;
}

export function currentAgent(): string | undefined {
  const hint = agentOption ?? process.env["TODOPI_AGENT"];
  if (hint !== undefined && hint !== "") {
    if (!AGENT_NAMES.includes(hint)) {
      throw new CliError(EXIT.usage, `Unknown agent ${JSON.stringify(hint)} (from --agent or TODOPI_AGENT); expected one of: ${AGENT_NAMES.join(", ")}.`);
    }
    return hint;
  }
  return agentFromEnv(process.env);
}

/**
 * 有没有 agent 在场（决定要不要上色，tp-rk6o8q）：--agent / TODOPI_AGENT 给了，或环境里**任何一个** agent 信号在。
 * 与 currentAgent 不同：嵌套时（两家的信号都在）身份推断不猜，上色则更要保守——转义不能进任何一家的上下文。
 */
export function agentPresent(): boolean {
  const hint = agentOption ?? process.env["TODOPI_AGENT"];
  if (hint !== undefined && hint !== "") return true;
  return AGENT_SIGNALS.some((s) => {
    const v = process.env[s.env];
    return v !== undefined && v !== "";
  });
}
