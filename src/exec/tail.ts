// src/exec/tail.ts
// 一个有界的尾部环。与 exec/ 同层的小工具，不认识 todopi 的格式。

/**
 * 只留最后 `max` 字节。**任何时刻**占用都不超过 `max` 加一个 chunk——这是
 * 「捕获的内存有界」那句话的全部依据，所以它必须自己成立，而不是靠
 * 「反正最后会截尾」。
 *
 * 单独成一个模块，是为了让这条不变量能被**确定性地**断言。量 runner 的常驻内存
 * 要外调 `ps`，而 `ps` 在受限环境里会 EPERM（实测，Codex 评审复跑时就撞上了），
 * 那样的用例会因为环境而红。`process.memoryUsage()` 也不行：它统计的是已分配未
 * 回收，丢掉的 chunk 在下一次 GC 之前仍然记在账上（实测：推 200 MB 进去，
 * `external` 长了 32 MB，而环实际只持有 164 KB）。所以由它自己报。
 */
export function makeTail(max: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  let dropped = false;
  return {
    push(c: Buffer): void {
      chunks.push(c);
      total += c.length;
      // 丢到「再丢一个就不够 max 了」为止，于是留下的恰好覆盖尾部 max 字节
      while (chunks.length > 1 && total - chunks[0]!.length >= max) {
        total -= chunks.shift()!.length;
        dropped = true;
      }
    },
    /** 此刻实际持有多少字节。不变量：不超过 `max` 加一个 chunk。 */
    retainedBytes(): number {
      return total;
    },
    truncated(): boolean {
      return dropped || total > max;
    },
    text(): string {
      const all = Buffer.concat(chunks);
      if (all.length <= max) return all.toString("utf8");
      return all.subarray(all.length - max).toString("utf8");
    },
  };
}
