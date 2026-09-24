import { test } from "node:test";
import assert from "node:assert";
// @ts-expect-error —— .mjs 工具没有类型声明
import { findUnbracedVars } from "../../tools/check-shell-vars.mjs";

const find = (s: string): [number, string][] => findUnbracedVars(s) as [number, string][];

// 判据是文字上的相邻，不看上下文（F10 第七轮，DECISIONS）。下面几条「照报」的用例在第一至第六轮里断言的是
// 「不报」——那时检查器试图只报会被展开的；现在它们钉住的是反过来的设计：多报是有意的，`${x}` 就能消掉。

test("双引号里、裸露的 $x，—— 报", () => {
  assert.deepEqual(find('echo "值是 $x，好"'), [[1, "x"]]);
  assert.deepEqual(find("echo $x（"), [[1, "x"]]);
});

test("注释、单引号、不展开的 heredoc 里的 $x， —— 同样报（有意多报）", () => {
  assert.deepEqual(find("# 注释里 $x，"), [[1, "x"]]);
  assert.deepEqual(find("echo hi  # $x，"), [[1, "x"]]);
  assert.deepEqual(find("echo '$x，'"), [[1, "x"]]);
  assert.deepEqual(find("cat <<'EOF'\n$x，\nEOF"), [[2, "x"]]);
});

test("加了花括号、后面是 ASCII、$ 后面不是名字 —— 不报", () => {
  assert.deepEqual(find('echo "${x}，"'), []);
  assert.deepEqual(find("echo $x, $1，"), []);
  assert.deepEqual(find("echo 价格 $ 5，"), []);
});

test("反斜杠续行先删掉：续行后紧跟的非 ASCII、被续行切开的名字，都报在 $ 所在的行（第四轮评审）", () => {
  assert.deepEqual(find("echo $x\\\n，"), [[1, "x"]]);
  assert.deepEqual(find("echo $fo\\\no，"), [[1, "foo"]]);
  assert.deepEqual(find('echo $fo\\\no\necho "$y，"'), [[3, "y"]], "被删掉的续行照样计入行号");
});

test("第四至第七轮评审构造过的每个漏报：全部报出", () => {
  const cases: [string, number][] = [
    ["echo foo\\ #$x，", 1],
    ["echo foo\\\n#$x，", 2],
    ["cat <<EOF2\n'\nEOF2\necho $x，", 4],
    ["cat <<'E''OF'\n'\nEOF\necho $x，", 4],
    ["cat <<END-TAG\n'\nEND-TAG\necho $x，", 4],
    ["cat <<A <<B\nfirst\nA\n$x，\nB", 4],
    ["((\n1<<\"2\"\n))\necho $x，", 4],
    ['cat <<"E\\"OF"\nbody\nE"OF\necho $x，', 4],
  ];
  for (const [src, line] of cases) assert.deepEqual(find(src), [[line, "x"]], JSON.stringify(src));
});
