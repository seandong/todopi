// src/format/discover.ts
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { EXIT, CliError } from "../exit.ts";

/** 本实现支持的最高格式版本。spec §9：读者 MUST 拒绝写入更高版本，SHOULD 仍能读。 */
export const SUPPORTED_VERSION = 1;

export type Config = {
  version: number;
  id_prefix: string;
  lease_hours: number;
  verify_timeout_seconds: number;
  /** 原始映射。未知键 MUST 被保留（spec §3）。 */
  raw: Record<string, unknown>;
};

export type Ledger = { root: string; dir: string; config: Config };

/**
 * 读一个已存在的 .todopi/ 的版本并施加版本闸门；目录或 config.yml 不存在时返回 null。
 *
 * 抽出来是因为 init 需要它：spec §9 与 FR-Q2 要求**任何命令**在遇到高版本账本时
 * 退出 4，而 init 不走 discoverLedger（它的职责恰恰是账本还不存在时创建）。
 * 没有这一步，init 会在一个自己读不懂的账本上继续写——Codex review 抓到的阻塞项。
 */
export function assertSupportedVersionIfPresent(dir: string): number | null {
  if (!existsSync(join(dir, "config.yml"))) return null;
  return readConfig(dir).version;
}

/** 从 startDir 向上走，直到找到含 .todopi/ 的目录或到达文件系统根。 */
/** 从 startDir 往上找 `.todopi/`；找不到返回 null（钩子据此静默退出，见 commands/hook.ts）。 */
export function findLedger(startDir: string): Ledger | null {
  let cur = resolve(startDir);
  for (;;) {
    const candidate = join(cur, ".todopi");
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return { root: cur, dir: candidate, config: readConfig(candidate) };
    }
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

export function discoverLedger(startDir: string): Ledger {
  const found = findLedger(startDir);
  if (found !== null) return found;
  throw new CliError(
    EXIT.usage,
    `No .todopi/ directory found at or above ${resolve(startDir)}. Run "todopi init" first.`,
  );
}

function readConfig(dir: string): Config {
  const path = join(dir, "config.yml");
  if (!existsSync(path)) {
    throw new CliError(EXIT.usage, `${path} is missing. The .todopi/ directory is incomplete.`);
  }
  let raw: Record<string, unknown>;
  try {
    const parsed = parseYaml(readFileSync(path, "utf8")) as unknown;
    raw = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch (err) {
    throw new CliError(EXIT.usage, `${path} could not be parsed: ${(err as Error).message.split("\n")[0]}`);
  }

  const version = typeof raw["version"] === "number" ? raw["version"] : NaN;
  if (!Number.isInteger(version)) {
    throw new CliError(EXIT.usage, `${path} is missing the required integer field "version".`);
  }
  if (version > SUPPORTED_VERSION) {
    throw new CliError(
      EXIT.unsupportedVersion,
      `This ledger is format version ${version}; this build supports up to ${SUPPORTED_VERSION}. Upgrade todopi and try again.`,
    );
  }
  return {
    version,
    id_prefix: typeof raw["id_prefix"] === "string" ? raw["id_prefix"] : "tp",
    lease_hours: typeof raw["lease_hours"] === "number" ? raw["lease_hours"] : 2,
    verify_timeout_seconds:
      typeof raw["verify_timeout_seconds"] === "number" ? raw["verify_timeout_seconds"] : 600,
    raw,
  };
}
