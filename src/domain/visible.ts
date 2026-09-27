// src/domain/visible.ts
// 把一段来自任务文件的文字变成「终端上看到的就是它本身」：控制字符与改变显示顺序的 Unicode 字符写成可见的转义。纯函数。
//
// 为什么：verify 命令是任何写入者都能改的任务字段（FR-D4）。原样写到终端上，`<ESC>[2K\r` 这样的序列会把命令那一行擦掉，
// 人看着确认提示却看不到要执行的是什么（F26 Codex 评审实测）。只在显示时转义，执行的仍是原文。

/**
 * 按 Unicode 类别而不是逐个列举：控制字符（Cc，含 ESC、CR、LF、TAB、DEL、C1）、格式字符（Cf：零宽空格与连接符、双向文字覆盖与隔离、
 * 软连字符、BOM……）、行与段分隔符、默认不可见的码位（变体选择符之类），以及除普通空格以外的空白（不换行空格能把一个参数看成两个）。
 * 逐个列举漏过 U+200B（Codex 复审）。
 */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}\p{Default_Ignorable_Code_Point}]/gu;

export function visible(text: string): string {
  return text.replace(HIDDEN, (c) => {
    if (c === " ") return c;
    if (c === "\n") return "\\n";
    if (c === "\t") return "\\t";
    if (c === "\r") return "\\r";
    const code = c.codePointAt(0)!;
    if (code <= 0xff) return `\\x${code.toString(16).padStart(2, "0")}`;
    return code <= 0xffff ? `\\u${code.toString(16).padStart(4, "0")}` : `\\u{${code.toString(16)}}`;
  });
}
