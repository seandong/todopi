import { test } from "node:test";
import assert from "node:assert";
import { newIdBody, makeId } from "../../src/format/id.ts";
import { ID_RE } from "../../src/domain/types.ts";

test("id body 是六位 base36（spec §4）", () => {
  for (let i = 0; i < 200; i++) assert.match(newIdBody(), /^[0-9a-z]{6}$/);
});

test("makeId 产出的完整 id 匹配 spec §4 的正则", () => {
  for (const prefix of ["tp", "a", "abcdefgh", "x9"]) {
    assert.match(makeId(prefix, newIdBody()), ID_RE);
  }
});

test("1000 次生成的碰撞率可忽略（36^6 ≈ 22 亿）", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) seen.add(newIdBody());
  assert.ok(seen.size > 995, `1000 次生成只得到 ${seen.size} 个不同值，随机性有问题`);
});

test("分布覆盖整个字符集 —— 防止实现只用了部分字符", () => {
  const chars = new Set<string>();
  for (let i = 0; i < 2000; i++) for (const c of newIdBody()) chars.add(c);
  assert.equal(chars.size, 36, `只用到 ${chars.size} 个字符，应当是 36 个`);
});
