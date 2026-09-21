// src/format/init.ts
import { existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { writeFileAtomic } from "../fs/atomic.ts";
import { SUPPORTED_VERSION } from "./discover.ts";

export type LedgerInit = {
  /** 本次新建的文件，相对 root 的路径 */
  created: string[];
  /** 已存在因而未被改动的文件 */
  kept: string[];
};

/** config.yml 的默认值，取自 spec §3 的表格。 */
const DEFAULTS = { lease_hours: 2, verify_timeout_seconds: 600 } as const;

/**
 * 发射 config.yml。键的顺序按 spec §3 的表格，diff 才稳定。
 *
 * 注意这里**不**加引号：spec §5.1 的引号规则约束的是任务文件的 frontmatter，
 * 因为那里有自由文本（标题会含冒号与 #）。config.yml 的四个值都是整数或
 * 受限标识符，不存在被 YAML 重新解释的风险。
 */
export function renderConfig(prefix: string): string {
  return [
    `version: ${SUPPORTED_VERSION}`,
    `id_prefix: ${prefix}`,
    `lease_hours: ${DEFAULTS.lease_hours}`,
    `verify_timeout_seconds: ${DEFAULTS.verify_timeout_seconds}`,
    "",
  ].join("\n");
}

const GITIGNORE = [
  "# Derived data. May be deleted at any time; holds no state needed to reconstruct the ledger (spec §2).",
  ".cache/",
  "",
].join("\n");

/**
 * 在 root 下生成 .todopi/。幂等由**内容**决定而不是由「目录是否存在」决定：
 * 缺什么补什么，已有的一律不动。已存在的 config.yml 可能被用户改过 lease_hours，
 * 覆盖它就是丢用户的配置。
 */
export function initLedger(root: string, opts: { prefix: string }): LedgerInit {
  const dir = join(root, ".todopi");
  const created: string[] = [];
  const kept: string[] = [];

  mkdirSync(join(dir, "tasks"), { recursive: true });

  const files: Array<[string, string]> = [
    [join(dir, "config.yml"), renderConfig(opts.prefix)],
    [join(dir, ".gitignore"), GITIGNORE],
  ];
  for (const [path, content] of files) {
    if (existsSync(path)) {
      kept.push(relative(root, path));
      continue;
    }
    writeFileAtomic(path, content);
    created.push(relative(root, path));
  }
  return { created, kept };
}
