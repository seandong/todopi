import { test } from "node:test";
import assert from "node:assert";
import { parseFrontmatter } from "../../src/format/frontmatter.ts";

test("规范形态走扫描器", () => {
  const r = parseFrontmatter('id: "tp-a1b2c3"\nlabels: ["auth"]');
  assert.ok(r.ok);
  assert.equal(r.path, "scan");
  assert.deepEqual(r.data, { id: "tp-a1b2c3", labels: ["auth"] });
});

test("偏离形态回退到 yaml，且结果等价", () => {
  const r = parseFrontmatter("id: tp-a1b2c3\nlabels: [auth]");
  assert.ok(r.ok);
  assert.equal(r.path, "yaml");
  assert.deepEqual(r.data, { id: "tp-a1b2c3", labels: ["auth"] });
});

test("嵌套块交给 yaml 并保留结构", () => {
  const r = parseFrontmatter('id: "x"\nexternal:\n  linear:\n    id: "E-1"');
  assert.ok(r.ok);
  assert.equal(r.path, "yaml");
  assert.deepEqual(r.data, { id: "x", external: { linear: { id: "E-1" } } });
});

test("yaml 解析异常转成 error，不冒泡成崩溃", () => {
  const r = parseFrontmatter("a: 1\na: 2");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /重复|duplicate/i);
});

test("空 frontmatter 返回空对象而不是 null", () => {
  const r = parseFrontmatter("");
  assert.ok(r.ok);
  assert.deepEqual(r.data, {});
});

test("yaml 不把时间戳变成 Date（YAML 1.2 core schema）", () => {
  const r = parseFrontmatter("created: 2026-09-14T09:00:00Z");
  assert.ok(r.ok);
  assert.equal(typeof r.data["created"], "string");
});

test("不带引号的 rank 会变成数字——不 coerce，留给校验器报", () => {
  const r = parseFrontmatter("rank: 007");
  assert.ok(r.ok);
  assert.equal(r.data["rank"], 7);
});
