import { test } from "node:test";
import assert from "node:assert";
import { estimateTokens } from "../../src/domain/tokens.ts";

// 系数（用户 2026-09-26 定，PRD §15）：ASCII ÷ 4、CJK × 0.6、其余 ÷ 2，向上取整。
// 这里只验算系数本身与它的性质；不断言「典型 prime 输出约 145」——那组数字是 tiktoken 量的，
// 拿来测这个估算器是循环论证。

test("三类字符按各自系数计，合计向上取整", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);                 // 1.25 → 2
  assert.equal(estimateTokens("验收标准"), 3);               // 4 × 0.6 = 2.4 → 3
  assert.equal(estimateTokens("éü"), 1);                    // 2 ÷ 2
  assert.equal(estimateTokens("done 门禁"), 3);              // 5 ÷ 4 + 2 × 0.6 = 2.45 → 3
});

test("CJK 包括假名、谚文、全角标点与中文标点", () => {
  for (const ch of ["あ", "カ", "한", "，", "。", "（", "Ａ", "㐀"]) assert.equal(estimateTokens(ch.repeat(5)), 3, ch);
});

test("按码点计，不按 UTF-16 码元：一个 emoji 是一个「其余」字符", () => {
  assert.equal(estimateTokens("😀😀"), 1);
});

test("性质：加字符不会让估算变小；纯 ASCII 恰是 ⌈长度 ÷ 4⌉", () => {
  const alphabet = ["a", " ", "中", "é", "\n", "😀"];
  let s = "";
  for (let i = 0; i < 400; i++) {
    const before = estimateTokens(s);
    s += alphabet[(i * 7) % alphabet.length];
    assert.ok(estimateTokens(s) >= before);
  }
  for (let n = 0; n < 50; n++) assert.equal(estimateTokens("x".repeat(n)), Math.ceil(n / 4));
});
