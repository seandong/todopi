// src/exec/editor.ts
// `--edit`：用用户的编辑器改一段文字（FR-T4，F24）。不认识 todopi 的格式。
//
// 只在有终端时打开：没有终端（agent 在调用、脚本里）时直接拒绝，而不是阻塞在一个永远等不到输入的编辑器上——F07 立的规矩。
// 编辑器按 $VISUAL、$EDITOR、vi 的顺序取；值可以带参数（`code --wait`），经 sh 展开，文件路径作为独立参数传，不拼进命令串。

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class EditorError extends Error {}

/** 打开编辑器改 `initial`，返回保存后的内容。没有终端、编辑器启动失败或非零退出时抛 EditorError。 */
export function editText(initial: string, name = "todopi-task.md"): string {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    throw new EditorError("--edit needs a terminal to open an editor in; pass the fields as options instead");
  }
  const editor = process.env["VISUAL"] || process.env["EDITOR"] || "vi";
  const dir = mkdtempSync(join(tmpdir(), "todopi-edit-"));
  const file = join(dir, name);
  try {
    writeFileSync(file, initial);
    const r = spawnSync("sh", ["-c", `${editor} "$1"`, "sh", file], { stdio: "inherit" });
    if (r.error !== undefined) throw new EditorError(`could not start the editor ${JSON.stringify(editor)}: ${r.error.message}`);
    if (r.status !== 0) throw new EditorError(`the editor ${JSON.stringify(editor)} exited with ${r.status ?? r.signal}; nothing was changed`);
    return readFileSync(file, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
