#!/usr/bin/env bash
# tools/e2e/f16-setup-pi.sh —— F16 的 Layer 3。
# 扩展的事件与缓存由 commands/ 的用例覆盖；这里验证 CLI 接通：setup pi 写出扩展、幂等、提示信任；扩展照它
# 自己的调用方式（`todopi prime --hook --session <id>`，stdin 关闭）真能跑通、按会话记下时间。真 pi 的实测记在 PRD §17。

set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
if [ -n "${TODOPI_E2E_BIN:-}" ]; then printf '#!/bin/sh\nexec "%s" "$@"\n' "$TODOPI_E2E_BIN"; else printf '#!/bin/sh\nexec node %s/src/cli.ts "$@"\n' "$ROOT"; fi > "$TMP/bin/todopi"
chmod +x "$TMP/bin/todopi"
export PATH="$TMP/bin:$PATH"

W="$TMP/w"
mkdir -p "$W"
git -C "$W" init -q
todopi -C "$W" init >/dev/null 2>&1

out="$(todopi -C "$W" setup pi 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -q "^created .*/.pi/extensions/todopi.ts$" && printf '%s\n' "$out" | grep -q "trust" \
  && ok "setup pi 写出扩展并提示信任" || fail "rc=${rc}：$out"
[ "$(todopi -C "$W" setup pi 2>&1 | grep -c '^unchanged')" = "1" ] && ok "setup pi 幂等" || fail "setup pi 不幂等"
grep -q 'pi.exec("todopi", \["prime", "--hook", "--session", id\]' "$W/.pi/extensions/todopi.ts" && ok "扩展用 --session 传会话 id" || fail "扩展里没有预期的调用"

# 照扩展的调用方式跑：stdin 关闭（pi.exec 的 stdin 是 ignore），不能卡住；按 --session 记下会话
out="$(cd "$W" && todopi prime --hook --session pi-sess-1 </dev/null 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s\n' "$out" | tail -1 | grep -q "^No task in progress" && ok "prime --hook --session 跑通（stdin 关闭）" || fail "rc=${rc}：$out"
grep -q '"key":"session:pi-sess-1"' "$W"/.git/todopi/leases/sessions/*.json 2>/dev/null && ok "按 --session 记下会话" || fail "没按 --session 记"

[ "$FAILED" -eq 0 ] && { echo "f16-setup-pi: pass"; exit 0; } || { echo "f16-setup-pi: fail"; exit 1; }
