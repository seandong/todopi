// src/format/generated-file.ts
// setup 生成的整份文件（OpenCode 插件、pi 扩展）：由我们写、由我们整份替换。
//
// 归属靠**整个第一行**的标记：首行与标记逐字相同才算我们的文件、才会被替换；不是就拒绝（那是用户的文件）。标记只是
// 约定，不是证明——标记那一行本身写明了「首行是它的文件会被替换」（F15 评审）。符号链接（含悬空的）一律拒绝：
// existsSync 对悬空链接返回 false，原子替换会把链接换成普通文件。

import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "../fs/atomic.ts";
import { lstatOrNull } from "./claude-settings.ts";
import { EXIT, CliError } from "../exit.ts";

export type GeneratedFileResult = "created" | "updated" | "unchanged";

export function ensureGeneratedFile(path: string, content: string, marker: string): GeneratedFileResult {
  const link = lstatOrNull(path);
  if (link?.isSymbolicLink() === true) throw new CliError(EXIT.usage, `${path} is a symbolic link; left untouched.`);
  if (link === null) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileAtomic(path, content);
    return "created";
  }
  const current = readFileSync(path, "utf8");
  if (current === content) return "unchanged";
  if (current.split("\n", 1)[0] !== marker) {
    throw new CliError(EXIT.usage, `${path} exists and its first line is not todopi's marker, so it is not ours; left untouched. Move it aside, then run setup again.`);
  }
  writeFileAtomic(path, content, lstatSync(path).mode);
  return "updated";
}
