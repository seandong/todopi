import { test } from "node:test";
import assert from "node:assert";
import { rankBetween } from "../../src/format/emit.ts";

// spec §5.2：rank 是 ^[0-9a-z]{1,32}$，按码点比较（§7.4）。fractional-indexing 只认它自己形状
// 的键——手写的 `rank: "a"` 在规格上合法、doctor 判为干净，库却抛 `invalid order key: a`，
// 于是 add 与 move 在一个合法账本上直接崩（F10 评审实测，add 那半是我顺手查出来的）。

const RANK = /^[0-9a-z]{1,32}$/;
const D = "0123456789abcdefghijklmnopqrstuvwxyz";

/** 确定性的伪随机（不用 Math.random：失败时要能复现）。 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
function randomRank(r: () => number, maxLen: number): string {
  const len = 1 + Math.floor(r() * maxLen);
  let out = "";
  for (let i = 0; i < len; i++) out += D[Math.floor(r() * 36)];
  return out;
}

/**
 * lo 与 hi 之间确实没有任何字符串：当且仅当 hi 恰好是 lo 后面补**一个** 0。
 *
 * 第一版写的是「补若干个 0」——而 "a" < "a0" < "a00"。那个判据与实现错在同一处，于是两万组属性
 * 测试全绿、实现却在有空位时返回无解（F10 第二轮评审）。**判据不能是实现那个信念的复述**：下面另有
 * 一条暴力枚举的用例独立验证这条定理。
 */
function nothingBetween(lo: string, hi: string): boolean {
  return hi === lo + "0";
}

test("属性：任意两个规格合法的 rank 之间，结果严格落在中间且合法；无解时恰好是真无解", () => {
  const r = rng(42);
  let solved = 0;
  for (let i = 0; i < 20000; i++) {
    let lo = randomRank(r, 6), hi = randomRank(r, 6);
    if (lo === hi) continue;
    if (lo > hi) [lo, hi] = [hi, lo];
    const k = rankBetween(lo, hi);
    if (k === null) {
      assert.ok(nothingBetween(lo, hi), `${lo} 与 ${hi} 之间明明有解，却返回了 null`);
      continue;
    }
    assert.ok(RANK.test(k) && lo < k && k < hi, `${lo} < ${k} < ${hi} 不成立，或 ${k} 不合法`);
    solved += 1;
  }
  assert.ok(solved > 19000);
});

test("两端开放也行：--top 之前、追加到末尾之后", () => {
  const r = rng(7);
  for (let i = 0; i < 5000; i++) {
    const x = randomRank(r, 6);
    const before = rankBetween(null, x), after = rankBetween(x, null);
    if (before !== null) assert.ok(RANK.test(before) && before < x, `${before} 不小于 ${x}`);
    else assert.equal(x, "0", `${x} 之前明明有解`);
    assert.ok(after !== null && RANK.test(after) && x < after, `${x} 之后应当总有解，得到 ${after}`);
  }
});

test("手写的非库形状 rank 之后，追加会跳回库的键空间 —— 不会每次都往长里长", () => {
  // 朴素的中点算法在末尾追加时每一位只有几十个空位，几百条任务就撞到 32 字符上限；
  // 库的键把整数部分的长度编进首字母，能追加极多次而几乎不变长。
  let last = "a";                                 // 规格合法，库不认
  let early = 0;
  for (let i = 0; i < 5000; i++) {
    const next = rankBetween(last, null);
    assert.ok(next !== null && last < next, `第 ${i} 次追加失败：${last} → ${next}`);
    last = next!;
    if (i === 10) early = last.length;
  }
  // 判据是「长度停止增长」，不是某个具体长度：跳回库的键空间之后，追加几千次长度不变。
  assert.ok(last.length <= early, `第 10 次时 ${early} 个字符，5000 次后长到了 ${last.length}：${last}`);
});

test("结果永远不超过 32 个字符（spec §5.2），超了就是无解", () => {
  const lo = "a".repeat(31) + "0", hi = "a".repeat(31) + "1";      // 32 位，只差末位
  const k = rankBetween(lo, hi);
  assert.ok(k === null || (k.length <= 32 && lo < k && k < hi), `得到 ${k}`);
  assert.equal(rankBetween(lo, hi), null, "两个 32 位、只差末位的 rank 之间放不下一个 ≤32 位的串");
});


test("两个确定性反例：有空位就不能说无解", () => {
  assert.equal(rankBetween("a", "a00"), "a0");
  assert.equal(rankBetween(null, "00"), "0");
  assert.equal(rankBetween("a", "a0"), null, "这一对之间才真的没有字符串");
});

test("独立的判据：暴力枚举短串，验证「有解」的判断与实现一致", () => {
  // 不复述实现的信念：直接在所有长度 ≤ 3 的串里找一个 lo < s < hi。找得到而实现说无解，就是错。
  const all: string[] = [];
  const grow = (p: string): void => { if (p.length > 0) all.push(p); if (p.length < 3) for (const c of D) grow(p + c); };
  grow("");
  all.sort();
  const r = rng(99);
  for (let i = 0; i < 300; i++) {
    let lo = randomRank(r, 2), hi = randomRank(r, 2);
    if (i % 3 === 0) hi = lo + "0".repeat(1 + Math.floor(r() * 2));   // 专门覆盖「后缀是 0」的对
    if (lo === hi) continue;
    if (lo > hi) [lo, hi] = [hi, lo];
    const exists = all.some((s) => lo < s && s < hi);
    const k = rankBetween(lo, hi);
    if (exists) assert.ok(k !== null, `${lo} 与 ${hi} 之间暴力枚举找得到，实现却说无解`);
    if (k !== null) assert.ok(lo < k && k < hi);
  }
});

test("从 \"z\" 连续追加：不会过早耗尽（z 加 18 个 0 是一个更大的库键）", () => {
  let last = "z";
  for (let i = 0; i < 2000; i++) {
    const next = rankBetween(last, null);
    assert.ok(next !== null && last < next, `第 ${i} 次追加耗尽：${last}`);
    last = next!;
  }
  assert.ok(last.length <= 24, `从 z 追加 2000 次后长到了 ${last.length}：${last}`);
});
