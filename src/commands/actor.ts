// src/commands/actor.ts
// 把 FR-C4 解析链需要的外部事实取回来，交给 domain 的纯函数决定结果。
// 读命令与写命令共用这一个入口——两处各写一遍，迟早会对同一个人得出两个身份。

import { hostname } from "node:os";
import { resolveActor } from "../domain/actor.ts";
import { gitUserName } from "../fs/git.ts";
import { EXIT, CliError } from "../exit.ts";

/** 当前身份。`explicit` 是 `--as` 的值。 */
export function currentActor(root: string, explicit?: string): string {
  return resolveActor({
    explicit,
    env: process.env["TODOPI_ACTOR"],
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
