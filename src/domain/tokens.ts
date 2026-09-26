// src/domain/tokens.ts
// prime 的预算用的 token 估算（PRD FR-P1a、§15）。纯函数，不认识 todopi。
//
// **按字符类别加权**：ASCII ÷ 4、CJK × 0.6、其余 ÷ 2，向上取整（用户 2026-09-26 定）。
// 「字符数 ÷ 4」实测对中文低估 2–3 倍，已撤下；真 tokenizer 只能对准一家的 BPE，还要多一个
// 约 1.6 MB 的依赖。PRD 记录的实测：这组系数对中英文都在 ±15% 以内。

/** 中日韩文字与全角标点：一个字大约 0.6 个 token。 */
const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/u;

export function estimateTokens(text: string): number {
  let ascii = 0, cjk = 0, other = 0;
  for (const ch of text) {                     // for…of 按码点走：一个 emoji 是一个字符
    if (ch.codePointAt(0)! < 128) ascii += 1;
    else if (CJK.test(ch)) cjk += 1;
    else other += 1;
  }
  // 以 1/20 token 为单位做整数运算：ASCII 5、CJK 12、其余 10。
  return Math.ceil((ascii * 5 + cjk * 12 + other * 10) / 20);
}
