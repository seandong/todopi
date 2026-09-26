#!/usr/bin/env bash
# tools/e2e/f13-doctor-fix.sh —— F13 的 Layer 3。
# 各类修复的判据由 commands/ 的用例覆盖；这里验证 CLI 真的接通了：人手写的语料文件修成加引号形态、
# Log 与 updated 逐字节不变、仍有问题时退出 1、修完再跑是幂等的。

set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cli() { node "$ROOT/src/cli.ts" "$@"; }

W="$TMP/w"
mkdir -p "$W"
cli -C "$W" init >/dev/null 2>&1
F="$W/.todopi/tasks/tp-a1b2c3.md"
cp spec/fixtures/valid/unquoted-hand-written.md "$F"
printf '\n## Log\n\n- 2026-09-14T09:00:00Z me@h created\n- this line does not parse\n' >> "$F"
log_before="$(sed -n '/^## Log$/,$p' "$F")"
upd_before="$(grep '^updated:' "$F")"

# 1. 有一行 Log 解析不了：修了能修的，Log 原样，退出 1
cli -C "$W" doctor --fix >"$TMP/out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && ok "仍有问题（解析不了的 Log 行）：退出 1" || fail "退出 $rc：$(cat "$TMP/out")"
grep -q '^title: "A hand-written task"$' "$F" && ok "标题修成加引号形态" || fail "标题没修：$(grep '^title' "$F")"
grep -q '^fixed tasks/tp-a1b2c3.md: ' "$TMP/out" && ok "报告列出修了哪个文件" || fail "报告：$(cat "$TMP/out")"
[ "$(sed -n '/^## Log$/,$p' "$F")" = "$log_before" ] && ok "Log 逐字节不变（含解析不了的那一行）" || fail "Log 被改了"
[ "$(grep '^updated:' "$F" | tr -d '"')" = "$(printf '%s' "$upd_before" | tr -d '"')" ] && ok "updated 的值不变" || fail "updated 变了：$(grep '^updated:' "$F")"

# 2. 去掉那行坏 Log（人来修），再跑：通过，且幂等
grep -v '^- this line does not parse$' "$F" > "$TMP/x" && cp "$TMP/x" "$F"
cli -C "$W" doctor --fix >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "人修掉坏 Log 之后：退出 0" || fail "退出 $rc"
snap="$(cat "$F")"
out="$(cli -C "$W" doctor --fix 2>&1)"
[ "$(cat "$F")" = "$snap" ] && printf '%s\n' "$out" | grep -q "nothing to normalize" && ok "再跑一遍：什么都不改" || fail "不幂等：$out"

[ "$FAILED" -eq 0 ] && { echo "f13-doctor-fix: pass"; exit 0; } || { echo "f13-doctor-fix: fail"; exit 1; }
