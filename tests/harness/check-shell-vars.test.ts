import { test } from "node:test";
import assert from "node:assert";
// @ts-expect-error —— .mjs 工具没有类型声明
import { findUnbracedVars } from "../../tools/check-shell-vars.mjs";

const find = (s: string): [number, string][] => findUnbracedVars(s) as [number, string][];

test("双引号里、裸露的 $x，会被展开 —— 报", () => {
  assert.deepEqual(find('echo "值是 $x，好"'), [[1, "x"]]);
  assert.deepEqual(find("echo $x（"), [[1, "x"]]);
});

test("注释与单引号里的 $x， 不展开 —— 不报（第一版 grep 的误报）", () => {
  assert.deepEqual(find("# 注释里 $x，不算"), []);
  assert.deepEqual(find("echo hi  # $x，"), []);
  assert.deepEqual(find("echo '$x，'"), []);
});

test("跨行的单引号：node -e '...' 里面的都不算，出来之后的照报", () => {
  const s = ["node -e '", "const a = `$x，`;", "'", 'echo "$y，"'].join("\n");
  assert.deepEqual(find(s), [[4, "y"]]);
});

test("转义空格后的 # 不开注释：`foo\\ #$x，` 里的 $x 会被展开（评审构造的漏报）", () => {
  assert.deepEqual(find("echo foo\\ #$x，"), [[1, "x"]]);
});

test("反斜杠续行之后接着同一个词：下一行开头的 # 不开注释", () => {
  assert.deepEqual(find("echo foo\\\n#$x，"), [[2, "x"]]);
  assert.deepEqual(find("echo foo \\\n# 真的注释 $x，"), [], "续行后先有空格再 #：那是注释");
});

test("加了花括号就不报；双引号里的 # 不是注释", () => {
  assert.deepEqual(find('echo "${x}，"'), []);
  assert.deepEqual(find('echo "#tag $x，"'), [[1, "x"]]);
});
