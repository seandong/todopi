import { test } from "node:test";
import assert from "node:assert";
import { splitEnvelope } from "../../src/format/envelope.ts";

test("切分出 head 与 body", () => {
  const r = splitEnvelope('---\nid: "tp-a1b2c3"\n---\n\n## Description\n\nHi.\n');
  assert.ok(r);
  assert.equal(r.head, 'id: "tp-a1b2c3"');
  assert.equal(r.body, '\n## Description\n\nHi.\n');
});

test("body 可以为空", () => {
  const r = splitEnvelope('---\nid: "x"\n---\n');
  assert.ok(r);
  assert.equal(r.body, "");
});

test("缺少起始分隔符返回 null", () => {
  assert.equal(splitEnvelope('id: "x"\n'), null);
});

test("缺少结束分隔符返回 null", () => {
  assert.equal(splitEnvelope('---\nid: "x"\n\n## Description\n'), null);
});

test("body 里的 --- 不被当作结束分隔符", () => {
  const r = splitEnvelope('---\nid: "x"\n---\n\n## A\n\n---\n\n## B\n');
  assert.ok(r);
  assert.equal(r.head, 'id: "x"');
  assert.match(r.body, /## A[\s\S]*---[\s\S]*## B/);
});
