import { test } from "node:test";
import assert from "node:assert";
import { readAnswer } from "../../src/exec/prompt.ts";

/** 按字节喂一段输入，用完就是 EOF。 */
const feed = (s: string) => {
  const bytes = [...Buffer.from(s, "utf8")];
  let i = 0;
  return () => (i < bytes.length ? bytes[i++]! : null);
};

test("一行答案：LF 或 CR 结束（raw 模式的回车是 CR）", () => {
  assert.equal(readAnswer(feed("y\n")), "y");
  assert.equal(readAnswer(feed("yes\r")), "yes");
  assert.equal(readAnswer(feed("y\r\n")), "y");
  assert.equal(readAnswer(feed("\n")), "");
  assert.equal(readAnswer(feed("好\n")), "好");
});

test("EOF 一律是没有回答——哪怕前面已经敲了 y（y 之后 Ctrl-D 不算同意）", () => {
  assert.equal(readAnswer(feed("")), null);
  assert.equal(readAnswer(feed("y")), null);
  assert.equal(readAnswer(feed("yes")), null);
});
