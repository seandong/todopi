#!/usr/bin/env bash
# tools/e2e/f15-setup-codex-opencode.sh —— F15 的 Layer 3。
# 合并、标记、缓存的细节由 commands/ 的用例覆盖；这里验证 CLI 接通：setup codex 写出的钩子命令真能跑，
# setup opencode 生成的插件文件在 Node 里能加载、导出 TodopiPlugin。真 agent 的实测记在 PRD §17。

set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
printf '#!/bin/sh\nexec node %s/src/cli.ts "$@"\n' "$ROOT" > "$TMP/bin/todopi"
chmod +x "$TMP/bin/todopi"
export PATH="$TMP/bin:$PATH"

W="$TMP/w"
mkdir -p "$W"
git -C "$W" init -q
todopi -C "$W" init >/dev/null 2>&1

# 1. codex：两个钩子，照写出的命令喂 Codex 形状的载荷去跑
out="$(todopi -C "$W" setup codex 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -q "^created .*/.codex/hooks.json$" && printf '%s\n' "$out" | grep -q "trust" \
  && ok "setup codex 写出 hooks.json 并提示信任" || fail "rc=${rc}：$out"
cmd="$(node -e 'const s=require(process.argv[1]);console.log(s.hooks.SessionStart[0].hooks[0].command)' "$W/.codex/hooks.json")"
payload='{"session_id":"codex-sess-1","hook_event_name":"SessionStart","source":"compact","cwd":"'"$W"'"}'
out="$(cd "$W" && printf '%s' "$payload" | sh -c "$cmd" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s\n' "$out" | tail -1 | grep -q "^No task in progress" && ok "Codex 的 SessionStart 命令跑通" || fail "rc=${rc}：$out"
grep -q '"key":"session:codex-sess-1"' "$W"/.git/todopi/leases/sessions/*.json 2>/dev/null && ok "按 Codex 载荷的 session_id 记下会话" || fail "没按 session_id 记"
[ "$(todopi -C "$W" setup codex 2>&1 | grep -c '^unchanged')" = "1" ] && ok "setup codex 幂等" || fail "setup codex 不幂等"

# 2. opencode：插件文件能加载、导出 TodopiPlugin；幂等
out="$(todopi -C "$W" setup opencode 2>&1)"; rc=$?
P="$W/.opencode/plugins/todopi.js"
[ "$rc" -eq 0 ] && [ -f "$P" ] && ok "setup opencode 写出插件" || fail "rc=${rc}：$out"
node --input-type=module -e "const m = await import('file://$P'); if (typeof m.TodopiPlugin !== 'function') process.exit(1);" 2>/dev/null \
  && ok "插件在 Node 里能加载，导出 TodopiPlugin" || fail "插件加载失败"
[ "$(todopi -C "$W" setup opencode 2>&1 | grep -c '^unchanged')" = "1" ] && ok "setup opencode 幂等" || fail "setup opencode 不幂等"

[ "$FAILED" -eq 0 ] && { echo "f15-setup-codex-opencode: pass"; exit 0; } || { echo "f15-setup-codex-opencode: fail"; exit 1; }
