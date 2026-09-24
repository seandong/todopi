#!/usr/bin/env bash
# tools/e2e/f09-note-check.sh —— F09 的 Layer 3。
# 翻哪一行、心跳归谁由 commands/ 的用例覆盖；这里验证 CLI 真的接通了：退出码、
# 多行参数穿过 shell 之后仍是一条 Log、check 与 done 的门禁连起来了。

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
T="$(cli -C "$W" --as me@h --json add "the task" --ac "first box" --ac "second box" 2>/dev/null | jget '.id')"
# 夹具没建起来时，下面的否定式断言会平白成立（F08 的 e2e 栽过一次）
[ -n "$T" ] || { fail "夹具没建起来"; echo "f09-note-check: fail"; exit 1; }
cli -C "$W" --as me@h claim "$T" >/dev/null 2>&1

# 1. note：多行参数穿过 shell 之后仍是一条 Log
cli -C "$W" --as me@h note "$T" "line one
line two" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "note 退出 0" || fail "note 退出 $rc"
n="$(cli -C "$W" --json show "$T" --full 2>/dev/null | jget '.log_total')"
[ "$n" = "3" ] && ok "多行 note 是一条 Log（created, claimed, note）" || fail "Log 条数 $n，期望 3"
txt="$(cli -C "$W" --json show "$T" 2>/dev/null | jget '.log.at(-1).text')"
[ "$txt" = "line one
line two" ] && ok "show 读回的正文完整" || fail "正文读回来是 $(printf %q "$txt")"

# 2. check：没勾完时 done 被挡；勾完之后放行
cli -C "$W" --as me@h check "$T" 1 >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "check 1 退出 0" || fail "check 1 退出 $rc"
cli -C "$W" --as me@h done "$T" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "还有一条没勾：done 退出 2" || fail "done 应被验收门禁挡下，实际退出 $rc"
cli -C "$W" --as me@h check "$T" 2 >/dev/null 2>&1
cli -C "$W" --as me@h done "$T" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "两条都勾了：done 退出 0" || fail "勾完之后 done 退出 $rc"

# 3. check 的幂等、越界、--json
U="$(cli -C "$W" --as me@h --json add "another" --ac "only" 2>/dev/null | jget '.id')"
[ -n "$U" ] || { fail "第二个夹具没建起来"; echo "f09-note-check: fail"; exit 1; }
cli -C "$W" --as me@h check "$U" 1 >/dev/null 2>&1
out="$(cli -C "$W" --as me@h --json check "$U" 1 2>/dev/null)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(printf '%s' "$out" | jget '.changed')" = "false" ] \
  && ok "重复 check：退出 0 且 changed=false" || fail "重复 check 不是幂等的（rc=$rc）"
cli -C "$W" --as me@h check "$U" 2 >/dev/null 2>"$TMP/e"; rc=$?
[ "$rc" -eq 1 ] && grep -q "there is no #2" "$TMP/e" && ok "越界：退出 1 并说明" || fail "越界 check 退出 $rc"
cli -C "$W" --as me@h check "$U" 1.5 >/dev/null 2>&1; rc=$?
[ "$rc" -eq 1 ] && ok "编号 1.5 被拒（不会被读成 1）" || fail "编号 1.5 退出 $rc"

# 4. 别人持有：退出 3
cli -C "$W" --as other@h claim "$U" >/dev/null 2>&1
cli -C "$W" --as me@h note "$U" "x" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 3 ] && ok "别人持有时 note 退出 3" || fail "别人持有时 note 退出 $rc"

cli -C "$W" doctor >/dev/null 2>&1 && ok "全程之后 doctor 通过" || fail "doctor 不通过"

[ "$FAILED" -eq 0 ] && { echo "f09-note-check: pass"; exit 0; } || { echo "f09-note-check: fail"; exit 1; }
