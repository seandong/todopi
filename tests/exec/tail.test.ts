import { test } from "node:test";
import assert from "node:assert";
import { makeTail } from "../../src/exec/tail.ts";

test("持有的字节数有界 —— 200 MB 推进去，手里始终只有上限那么多", () => {
  // **断言的是「仍然持有」，不是「进程占了多少」。** 两条路都试过：外调 `ps` 在
  // 受限环境里 EPERM（Codex 评审复跑时撞上了）；`process.memoryUsage().external`
  // 统计的是已分配未回收——实测推 200 MB 进去它长了 32 MB，而环实际只持有
  // 164 KB，那个数字量的是 GC 的节奏，不是这里的不变量。
  //
  // 真实常驻内存由 run.test.ts 里那条起 runner 采 RSS 的用例把关；这一条管的是
  // 不变量本身，而它不依赖任何外部命令，永远跑得了。
  const max = 64 * 1024;
  const chunk = 100_000;
  const tail = makeTail(max);
  let peak = 0;
  for (let i = 0; i < 2_000; i += 1) {
    tail.push(Buffer.alloc(chunk, 0x5a));
    peak = Math.max(peak, tail.retainedBytes());
  }
  assert.ok(peak <= max + chunk,
    `推进去 200 MB，峰值持有 ${peak} 字节，超过了「上限加一个 chunk」= ${max + chunk}`);
  assert.equal(tail.text().length, max);
  assert.equal(tail.truncated(), true);
});

test("留下的确实是**尾部**，不是碰巧剩下的那几块", () => {
  const tail = makeTail(10);
  for (const s of ["abcdefg", "hij", "klmnop"]) tail.push(Buffer.from(s, "utf8"));
  assert.equal(tail.text(), "ghijklmnop");
});

test("没超过上限时原样保留，也不置 truncated", () => {
  const tail = makeTail(1024);
  tail.push(Buffer.from("hello ", "utf8"));
  tail.push(Buffer.from("world", "utf8"));
  assert.equal(tail.text(), "hello world");
  assert.equal(tail.truncated(), false);
});

test("恰好等于上限时不算截断 —— 边界是 >，不是 >=", () => {
  const tail = makeTail(5);
  tail.push(Buffer.from("abcde", "utf8"));
  assert.equal(tail.text(), "abcde");
  assert.equal(tail.truncated(), false);
});
