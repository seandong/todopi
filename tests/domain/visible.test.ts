import { test } from "node:test";
import assert from "node:assert";
import { visible, visibleMultiline } from "../../src/domain/visible.ts";

test("控制字符与双向文字字符写成可见转义；普通文字（含中文）原样", () => {
  assert.equal(visible("make test && echo 好"), "make test && echo 好");
  // Codex 评审的例子：清行 + 回车，想把命令从终端上擦掉
  assert.equal(visible("touch /tmp/proof #\u001b[2K\r"), "touch /tmp/proof #\\x1b[2K\\r");
  assert.equal(visible("a\nb\tc\u0007\u007f\u009b"), "a\\nb\\tc\\x07\\x7f\\x9b");
  assert.equal(visible("rm -rf x \u202e/ gnp.txt"), "rm -rf x \\u202e/ gnp.txt");
  assert.equal(visible("\u2066x\u2069\u200f"), "\\u2066x\\u2069\\u200f");
  // 零宽与其他默认不可见的字符（Codex 复审：U+200B 让 /tmp/approved 看起来是另一个路径）
  assert.equal(visible("rm -rf /tmp/approved\u200b"), "rm -rf /tmp/approved\\u200b");
  assert.equal(visible("a\u2060b\ufeffc\u00adD\u180e"), "a\\u2060b\\ufeffc\\xadD\\u180e");
  assert.equal(visible("x\ufe0fy\u{e0041}z"), "x\\ufe0fy\\u{e0041}z");
  // 只是格式字符、不属于「默认不可见」的：行间注释标记能把一段文字藏进「注释」里，阿拉伯数字符号会改变后面的显示
  assert.equal(visible("a\ufff9b\ufffac\ufffbd\u0600"), "a\\ufff9b\\ufffac\\ufffbd\\u0600");
  // 普通空格原样；其他空白（不换行空格、表意空格）与行 / 段分隔符转义
  assert.equal(visible("a b\u00a0c\u3000d\u2028e\u2029"), "a b\\xa0c\\u3000d\\u2028e\\u2029");
});

test("多行版：换行与 Tab 原样，其余与单行版相同（prime 的 Log 条目用它，F35）", () => {
  assert.equal(visibleMultiline("head\n  cont\tx"), "head\n  cont\tx");
  assert.equal(visibleMultiline("a\u200b\nb\u202e\r\u001b[2K"), "a\\u200b\nb\\u202e\\r\\x1b[2K");
  assert.equal(visible("a\nb"), "a\\nb", "单行版照样转义换行");
});
