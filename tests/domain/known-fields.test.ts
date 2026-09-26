import { test } from "node:test";
import assert from "node:assert";
import { KNOWN_FIELDS } from "../../src/domain/types.ts";
import { emitFrontmatter } from "../../src/format/emit.ts";

// 同一张表（spec §5.2）在 domain/ 与 format/ 各有一份：format/ 不能从 domain/ 引用值（ARCH-018）。
// 这里断言两份一致——按发射顺序发射全部已知字段，读出的键顺序就是 KNOWN_FIELDS。
test("domain 的 KNOWN_FIELDS 与发射器的字段顺序是同一张表", () => {
  const fm = Object.fromEntries([...KNOWN_FIELDS].reverse().map((k) => [k, "v"]));
  const keys = emitFrontmatter(fm).trimEnd().split("\n").map((l) => l.slice(0, l.indexOf(":")));
  assert.deepEqual(keys, [...KNOWN_FIELDS]);
});
