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

test("续行之后紧跟变量名的非 ASCII 字符：bash 先拼接再分词，照报（第四轮评审的漏报）", () => {
  assert.deepEqual(find("echo $x\\\n，"), [[1, "x"]]);
  assert.deepEqual(find("echo $fo\\\no，"), [[1, "foo"]], "变量名本身被续行切开");
  assert.deepEqual(find("echo '$x\\\n，'"), [], "单引号里反斜杠不续行，也不展开");
  assert.deepEqual(find("# 注释 $x\\\n，"), [], "注释里的反斜杠不续行");
  assert.deepEqual(find('echo $\\\n\necho "$y，"'), [[3, "y"]], "被删掉的续行照样计入行号");
  assert.deepEqual(find('echo $fo\\\no\necho "$y，"'), [[3, "y"]], "变量名中间被删掉的续行也计入行号");
});

test("heredoc 正文里的引号是数据：不改变之后的引号状态（第五轮评审的漏报）", () => {
  assert.deepEqual(find("cat <<EOF2\n'\nEOF2\necho $x，"), [[4, "x"]]);
});

test("heredoc：带引号的定界符不展开、不报；裸定界符展开、照报；<<- 去掉行首 Tab", () => {
  assert.deepEqual(find("cat <<'EOF'\n$x，\nEOF"), []);
  assert.deepEqual(find('cat <<"EOF"\n$x，\nEOF'), []);
  assert.deepEqual(find("cat <<\\EOF\n$x，\nEOF"), []);
  assert.deepEqual(find("cat <<EOF\n值 $x，\nEOF"), [[2, "x"]]);
  assert.deepEqual(find("cat <<-EOF\n\t$x，\n\tEOF\necho $y，"), [[2, "x"], [4, "y"]]);
  assert.deepEqual(find("cat <<-EOF\n\t'\n\tEOF\necho $y，"), [[4, "y"]], "<<- 的结束行可以有行首 Tab");
  assert.deepEqual(find("cat <<EOF\n\\$x，\nEOF"), [], "转义了的 $ 不展开");
});

test("一行上两个 heredoc 按顺序读，行号各自对（第六轮评审：第二段曾从第一段的起始行算）", () => {
  assert.deepEqual(find("cat <<A <<'B'\n$a，\nA\n$b，\nB\necho $c，"), [[2, "a"], [6, "c"]]);
  assert.deepEqual(find("cat <<A <<B\nfirst\nA\n$x，\nB"), [[4, "x"]]);
});

test("定界符是一个完整的 shell 词：引号片段拼接、连字符都算（第六轮评审）", () => {
  assert.deepEqual(find("cat <<'E''OF'\n'\nEOF\necho $x，"), [[4, "x"]]);
  assert.deepEqual(find("cat <<END-TAG\n'\nEND-TAG\necho $x，"), [[4, "x"]]);
  assert.deepEqual(find("cat <<E\"O\"F\n$y，\nEOF\necho $x，"), [[4, "x"]], "部分加引号也不展开");
  assert.deepEqual(find("cat <<EOF>/dev/null\n$y，\nEOF"), [[2, "y"]], "定界符在重定向符号前结束");
});

test("没有结束行的 heredoc 照 bash 延伸到文末；算术里的 << 是移位", () => {
  assert.deepEqual(find("cat <<EOF\n'\n$x，"), [[3, "x"]]);
  assert.deepEqual(find("cat <<'EOF'\n$x，"), []);
  assert.deepEqual(find("echo $(( 1<<x ))\necho $y，"), [[2, "y"]]);
  assert.deepEqual(find("(( a <<= b ))\necho $y，"), [[2, "y"]]);
});
