import { test } from "node:test";
import assert from "node:assert";
import { visible } from "../../src/domain/visible.ts";

test("控制字符与双向文字字符写成可见转义；普通文字（含中文）原样", () => {
  assert.equal(visible("make test && echo 好"), "make test && echo 好");
  // Codex 评审的例子：清行 + 回车，想把命令从终端上擦掉
  assert.equal(visible("touch /tmp/proof #\u001b[2K\r"), "touch /tmp/proof #\\x1b[2K\\r");
  assert.equal(visible("a\nb\tc\u0007\u007f\u009b"), "a\\nb\\tc\\x07\\x7f\\x9b");
  assert.equal(visible("rm -rf x \u202e/ gnp.txt"), "rm -rf x \\u202e/ gnp.txt");
  assert.equal(visible("\u2066x\u2069\u200f"), "\\u2066x\\u2069\\u200f");
});
