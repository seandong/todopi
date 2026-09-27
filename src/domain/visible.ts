// src/domain/visible.ts
// 把一段来自任务文件的文字变成「终端上看到的就是它本身」：控制字符与改变显示顺序的 Unicode 字符写成可见的转义。纯函数。
//
// 为什么：verify 命令是任何写入者都能改的任务字段（FR-D4）。原样写到终端上，`<ESC>[2K\r` 这样的序列会把命令那一行擦掉，
// 人看着确认提示却看不到要执行的是什么（F26 Codex 评审实测）。只在显示时转义，执行的仍是原文。

/** C0 / C1 控制字符（含 ESC、CR、LF、TAB、DEL），以及双向文字覆盖与隔离字符。 */
const HIDDEN = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

export function visible(text: string): string {
  return text.replace(HIDDEN, (c) => {
    const code = c.charCodeAt(0);
    if (c === "\n") return "\\n";
    if (c === "\t") return "\\t";
    if (c === "\r") return "\\r";
    return code <= 0xff ? `\\x${code.toString(16).padStart(2, "0")}` : `\\u${code.toString(16).padStart(4, "0")}`;
  });
}
