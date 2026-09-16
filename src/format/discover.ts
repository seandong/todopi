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

/** 从 startDir 向上走，直到找到含 .todopi/ 的目录或到达文件系统根。 */
export function discoverLedger(startDir: string): Ledger {
  let cur = resolve(startDir);
  for (;;) {
    const candidate = join(cur, ".todopi");
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return { root: cur, dir: candidate, config: readConfig(candidate) };
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new CliError(
    EXIT.usage,
    `从 ${resolve(startDir)} 向上没有找到 .todopi/ 目录。先运行 todopi init。`,
  );
}

function readConfig(dir: string): Config {
  const path = join(dir, "config.yml");
  if (!existsSync(path)) {
    throw new CliError(EXIT.usage, `${path} 不存在。.todopi/ 目录不完整。`);
  }
  let raw: Record<string, unknown>;
  try {
    const parsed = parseYaml(readFileSync(path, "utf8")) as unknown;
    raw = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch (err) {
    throw new CliError(EXIT.usage, `${path} 无法解析：${(err as Error).message.split("\n")[0]}`);
  }

  const version = typeof raw["version"] === "number" ? raw["version"] : NaN;
  if (!Number.isInteger(version)) {
    throw new CliError(EXIT.usage, `${path} 缺少必填的整数字段 version。`);
  }
  if (version > SUPPORTED_VERSION) {
    throw new CliError(
      EXIT.unsupportedVersion,
      `这个账本是格式版本 ${version}，本实现只支持到 ${SUPPORTED_VERSION}。升级 todopi 后再试。`,
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
