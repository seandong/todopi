#!/usr/bin/env bash
# tools/e2e/f10-edit-move-dep.sh —— F10 的 Layer 3。
# 邻居怎么算、哪些字段算变了由 commands/ 的用例覆盖；这里验证 CLI 真的接通了：退出码、
# 环的路径出现在 stderr、move 在一个真 git 仓库里只改一个文件。

set -u
# 与跑它的 agent 无关（F22）：agent 的环境信号会让默认身份变成 <agent>@<host>，脚本里的身份断言按 git 用户名写
unset CLAUDECODE CODEX_THREAD_ID GEMINI_CLI OPENCODE PI_SESSION_ID CURSOR_AGENT TODOPI_AGENT TODOPI_ACTOR
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cli() { if [ -n "${TODOPI_E2E_BIN:-}" ]; then "$TODOPI_E2E_BIN" "$@"; else node "$ROOT/src/cli.ts" "$@"; fi; }
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=eval("JSON.parse(s)"+process.argv[1]);process.stdout.write(typeof v==="string"?v:JSON.stringify(v))})' "$1"; }

W="$TMP/w"
mkdir -p "$W"
git -C "$W" init -q
git -C "$W" config user.name t; git -C "$W" config user.email t@e
cli -C "$W" init >/dev/null 2>&1
add() { cli -C "$W" --as me@h --json add "$1" 2>/dev/null | jget '.id'; }
A="$(add a)"; B="$(add b)"; C="$(add c)"
[ -n "$A" ] && [ -n "$B" ] && [ -n "$C" ] || { fail "夹具没建起来"; echo "f10-edit-move-dep: fail"; exit 1; }
git -C "$W" add -A && git -C "$W" commit -qm fixtures

# 1. dep：加边、成环时退出 1 并在 stderr 里给出环的路径
cli -C "$W" dep add "$A" --on "$B" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "dep add 退出 0" || fail "dep add 退出 $rc"
cli -C "$W" dep add "$B" --on "$C" >/dev/null 2>&1
cli -C "$W" dep add "$C" --on "$A" >"$TMP/o" 2>"$TMP/e"; rc=$?
[ "$rc" -eq 1 ] && ok "成环：退出 1" || fail "成环时退出 $rc"
# 断言一条连续、闭合的有向路径（A 等 B、B 等 C、C 等 A），而不只是三个 id 各自出现。
path="$(grep -oE "cycle in the blocked_by graph: [a-z0-9 >-]+" "$TMP/e" | sed 's/^cycle in the blocked_by graph: //')"
case " $path " in
  *" $A -> $B -> $C -> $A "*|*" $B -> $C -> $A -> $B "*|*" $C -> $A -> $B -> $C "*) ok "stderr 里有连续闭合的环：${path}" ;;
  *) fail "stderr 没有给出正确的环：$(cat "$TMP/e")" ;;
esac
# 否定式断言要有前提：先确认真的读到了 C 的 blocked_by，而不是空输出。被拒绝的是「C 等 A」，
# 而 C 此前没有任何依赖（是 B 在等 C），所以它应当仍是空数组。
bb="$(cli -C "$W" --json show "$C" 2>/dev/null | jget '.blocked_by')"
[ "$bb" = "[]" ] && ok "被拒绝时什么都没写（C 的 blocked_by 仍为空）" || fail "C 的 blocked_by 是 ${bb}，期望 []"
out="$(cli -C "$W" --json dep add "$A" --on "$B" 2>/dev/null)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(printf '%s' "$out" | jget '.changed')" = "false" ] && ok "重复加边：幂等" || fail "重复加边 rc=$rc"
git -C "$W" add -A && git -C "$W" commit -qm deps

# 2. move：只改一个文件
cli -C "$W" move "$C" --top >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "move --top 退出 0" || fail "move --top 退出 $rc"
n="$(git -C "$W" status --porcelain | wc -l | tr -d ' ')"
changed="$(git -C "$W" status --porcelain | awk '{print $2}')"
# git 比的是内容：原样重写的邻居看不出来。「只写了一个文件」的判据（比 inode）在单元用例里。
[ "$n" = "1" ] && [ "$changed" = ".todopi/tasks/$C.md" ] && ok "只有被挪的那个文件内容变了" || fail "move 改了 $n 个文件：$changed"
first="$(cli -C "$W" --json ls --all 2>/dev/null | jget '[0].id')"
[ "$first" = "$C" ] && ok "它现在排第一" || fail "排第一的是 $first"

# 3. edit：记 edited fields=…，--label 的 -x 不被当成选项
# 先把 nope 加上，删除才看得出效果——夹具里本来没有 nope 的话，忽略 -nope 的实现也能过（评审指出）。
cli -C "$W" edit "$A" --label +nope >/dev/null 2>&1; rc=$?
seeded="$(cli -C "$W" --json show "$A" 2>/dev/null | jget '.labels')"
[ "$rc" -eq 0 ] && [ "$seeded" = '["nope"]' ] && ok "先种上 nope" || fail "种 nope 失败：rc=$rc labels=${seeded}"
cli -C "$W" edit "$A" --title "a renamed" --label +x --label -nope >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "edit 退出 0（--label -nope 被当成值而不是选项）" || fail "edit 退出 $rc"
lbl="$(cli -C "$W" --json show "$A" 2>/dev/null | jget '.labels')"
[ "$lbl" = '["x"]' ] && ok "标签是 [x]：nope 真的删掉了" || fail "标签是 ${lbl}，期望 [\"x\"]"
tail -1 "$W/.todopi/tasks/$A.md" | grep -q "edited fields=labels,title$" && ok "Log 记 edited fields=labels,title" || fail "Log 行是 $(tail -1 "$W/.todopi/tasks/$A.md")"
cli -C "$W" edit "$A" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 1 ] && ok "什么都不给：退出 1" || fail "什么都不给时退出 $rc"

cli -C "$W" doctor >/dev/null 2>&1 && ok "全程之后 doctor 通过" || fail "doctor 不通过"

[ "$FAILED" -eq 0 ] && { echo "f10-edit-move-dep: pass"; exit 0; } || { echo "f10-edit-move-dep: fail"; exit 1; }
