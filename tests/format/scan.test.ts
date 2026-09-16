import { test } from "node:test";
import assert from "node:assert";
import { scanCanonical } from "../../src/format/scan.ts";

test("扫描规范形态的标量与列表", () => {
  const r = scanCanonical('id: "tp-a1b2c3"\nlabels: ["auth", "web"]\nblocked_by: []');
  assert.deepEqual(r, { id: "tp-a1b2c3", labels: ["auth", "web"], blocked_by: [] });
});

test("值里的冒号、# 号、前导零都原样保留", () => {
  const r = scanCanonical('title: "feat: add login #42"\nrank: "007"');
  assert.deepEqual(r, { title: "feat: add login #42", rank: "007" });
});

test("还原 \\\\ 与 \\\" 两种转义", () => {
  const r = scanCanonical('title: "He said \\"yes\\" then left C:\\\\path"');
  assert.deepEqual(r, { title: 'He said "yes" then left C:\\path' });
});

test("x- 扩展键被接受", () => {
  assert.deepEqual(scanCanonical('x-vendor: "v"'), { "x-vendor": "v" });
});

test.describe("偏离规范形态时返回 null（交给 yaml），而不是报错", () => {
  const deviations: Array<[string, string]> = [
    ["不带引号的标量", "id: tp-a1b2c3"],
    ["缩进块", 'external:\n  linear:\n    id: "E-1"'],
    ["注释行", '# a comment\nid: "x"'],
    ["单引号", "id: 'x'"],
    ["锚点", 'id: &a "x"'],
    ["块标量", 'title: |\n  multi'],
    ["未闭合的引号", 'id: "x'],
    ["列表元素不带引号", "labels: [auth]"],
    ["列表分隔符不是逗号加空格", 'labels: ["a","b"]'],
    ["未定义的转义", 'title: "a\\nb"'],
  ];
  for (const [name, src] of deviations) {
    test(name, () => assert.equal(scanCanonical(src), null));
  }
});
