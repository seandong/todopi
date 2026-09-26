// src/format/generated-file.ts
// setup 生成的整份文件（OpenCode 插件、pi 扩展）：由我们写、由我们整份替换。
//
// 归属靠**整个第一行**的标记：首行与标记逐字相同才算我们的文件、才会被替换；不是就拒绝（那是用户的文件）。标记只是
// 约定，不是证明——标记那一行本身写明了「首行是它的文件会被替换」（F15 评审）。符号链接（含悬空的）一律拒绝：
// existsSync 对悬空链接返回 false，原子替换会把链接换成普通文件。

import { lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, sep } from "node:path";
import { writeFileAtomic } from "../fs/atomic.ts";
import { lstatOrNull } from "./claude-settings.ts";
import { EXIT, CliError } from "../exit.ts";

export type GeneratedFileResult = "created" | "updated" | "unchanged";

/** `markerLine`：标记在第几行（从 0 起）。Cursor 的 .mdc 第一行必须是 frontmatter 的 `---`，标记放在第二行。 */
export function ensureGeneratedFile(path: string, content: string, marker: string, markerLine = 0): GeneratedFileResult {
  const link = lstatOrNull(path);
  if (link?.isSymbolicLink() === true) throw new CliError(EXIT.usage, `${path} is a symbolic link; left untouched.`);
  if (link === null) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileAtomic(path, content);
    return "created";
  }
  const current = readFileSync(path, "utf8");
  if (current === content) return "unchanged";
  if (current.split("\n")[markerLine] !== marker) {
    throw new CliError(EXIT.usage, `${path} exists and it does not carry todopi's marker line, so it is not ours; left untouched. Move it aside, then run setup again.`);
  }
  writeFileAtomic(path, content, lstatSync(path).mode);
  return "updated";
}

/**
 * 项目级 setup 的目标必须真的落在项目目录里：路径上的某个目录（`.pi`、`.opencode`、`.claude`……）若是指向项目外的
 * 符号链接，写入就越过了输出里显示的项目路径（F16 评审）。取目标路径上最近一个已存在的祖先，解析真实路径，要求它在
 * 项目根的真实路径之内。用户级（--user）不查：home 下用符号链接管理配置目录很常见。
 */
export function assertInsideProject(root: string, path: string): void {
  let probe = path;
  while (lstatOrNull(probe) === null && dirname(probe) !== probe) probe = dirname(probe);
  const real = realpathSync(probe);
  const base = realpathSync(root);
  if (real !== base && !real.startsWith(base + sep)) {
    throw new CliError(EXIT.usage, `${path} would be written outside the project (${probe} resolves to ${real}); left untouched. Use --user, or point that link inside the project.`);
  }
}
