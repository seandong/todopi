#!/usr/bin/env bash
# tools/e2e/f08-show.sh —— F08 的 Layer 3。
# 取哪几条 Log、父链怎么走由 commands/ 的用例覆盖；这里验证 CLI 真的接通了：
# 退出码、文本与 --json 两种输出、--full / --tree 两个开关。

set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cli() { node "$ROOT/src/cli.ts" "$@"; }
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=eval("JSON.parse(s)"+process.argv[1]);process.stdout.write(typeof v==="string"?v:JSON.stringify(v))})' "$1"; }

W="$TMP/w"
mkdir -p "$W"
cli -C "$W" init >/dev/null 2>&1
id_of() { cli -C "$W" --as me@h --json add "$@" 2>/dev/null | jget '.id'; }

P="$(id_of "parent task")"
T="$(id_of "the task" --parent "$P" --ac "first box" --ac "second box" --description "why it matters")"
C="$(id_of "a child" --parent "$T")"
# **先确认夹具真的建起来了。** 下面有几条是否定式的断言（「不含 created」）和
# 相等式的断言（`.id` 等于 `$T`）：id 为空、输出为空时它们会**平白成立**。第一版
# 就是这样——add 的参数写错，三个 id 全是空串，却有两条 pass（自己跑出来的假绿）。
if [ -z "$P" ] || [ -z "$T" ] || [ -z "$C" ]; then
  fail "夹具没建起来（P=$P T=$T C=${C}），后面的断言没有意义"
  echo "f08-show: fail"; exit 1
fi

for _ in 1 2 3; do
  cli -C "$W" --as me@h claim "$T" >/dev/null 2>&1
  cli -C "$W" --as me@h release "$T" >/dev/null 2>&1
done

# 1. 文本：标题行、描述、带序号的标准、Log 截断提示
out="$(cli -C "$W" show "$T" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "show 退出 0" || fail "show 退出 $rc"
printf '%s\n' "$out" | grep -q "^$T  the task$" && ok "第一行是 id 与标题" || fail "缺标题行"
printf '%s\n' "$out" | grep -q "why it matters" && ok "显示 Description" || fail "缺 Description"
printf '%s\n' "$out" | grep -q "^  2\. \[ \] second box$" && ok "验收标准带序号" || fail "验收标准没有序号"
printf '%s\n' "$out" | grep -q "Log (last 5 of 7; --full for all)" && ok "默认最近 5 条并给出总数" || fail "Log 截断提示不对"
# 否定式断言要有前提：输出里确实有 Log 行。否则「不含 created」对空输出同样成立。
# 用 Log 行的形状（`Z me@h created`）而不是裸的 " created"——后者会撞上
# frontmatter 的 `created` 字段行。
if printf '%s\n' "$out" | grep -q "Z me@h released" && ! printf '%s\n' "$out" | grep -q "Z me@h created"; then
  ok "显示的是最近 5 条，不是最早 5 条"
else
  fail "默认显示的不是最近 5 条"
fi

# 2. --full
full="$(cli -C "$W" show "$T" --full 2>&1)"; rc=$?
# 每条都断言退出 0：只查输出片段的话，打印完预期内容再失败也会报 pass（评审指出）。
[ "$rc" -eq 0 ] && ok "--full 退出 0" || fail "--full 退出 $rc"
printf '%s\n' "$full" | grep -q "^Log (7)$" && ok "--full 显示全部 7 条" || fail "--full 没展开"
printf '%s\n' "$full" | grep -q "Z me@h created" && ok "--full 包含最早那条" || fail "--full 缺最早那条"

# 3. --tree
tree="$(cli -C "$W" show "$T" --tree 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "--tree 退出 0" || fail "--tree 退出 $rc"
printf '%s\n' "$tree" | grep -q "^  $P  \[open\] \[0/1\] parent task$" && ok "--tree 显示父任务及其进度" || fail "--tree 缺父任务"
printf '%s\n' "$tree" | grep -q "^Children (0/1 closed)$" && ok "--tree 显示子任务进度" || fail "--tree 进度不对"
printf '%s\n' "$tree" | grep -q "^  $C  \[open\] a child$" && ok "--tree 列出子任务" || fail "--tree 缺子任务"

# 4. --json：单个对象，字段齐
json="$(cli -C "$W" --json show "$T" --tree 2>/dev/null)"; rc=$?
[ "$rc" -eq 0 ] && ok "--json 退出 0" || fail "--json 退出 $rc"
[ "$(printf '%s' "$json" | jget '.id')" = "$T" ] && ok "--json 是单个对象" || fail "--json 不是单个对象"
[ "$(printf '%s' "$json" | jget '.log_total')" = "7" ] && ok "--json 带 log_total" || fail "--json 缺 log_total"
[ "$(printf '%s' "$json" | jget '.tree.ancestors[0].id')" = "$P" ] && ok "--json 带父链" || fail "--json 缺父链"
[ "$(printf '%s' "$json" | jget '.acceptance.length')" = "2" ] && ok "--json 带验收标准" || fail "--json 缺验收标准"

# 5. 不存在的 id：退出 1，报错走 stderr
cli -C "$W" show tp-zzzzzz >"$TMP/o" 2>"$TMP/e"; rc=$?
[ "$rc" -eq 1 ] && ok "不存在的 id 退出 1" || fail "不存在的 id 退出 $rc"
grep -q "No task tp-zzzzzz" "$TMP/e" && ok "报错走 stderr" || fail "报错不在 stderr"
[ ! -s "$TMP/o" ] && ok "stdout 为空" || fail "stdout 不该有内容"

[ "$FAILED" -eq 0 ] && { echo "f08-show: pass"; exit 0; } || { echo "f08-show: fail"; exit 1; }
