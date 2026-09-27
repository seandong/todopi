#!/usr/bin/env bash
# tools/e2e/f25-newer-version.sh —— F25 的 Layer 3：格式版本更高的账本（spec §9：MUST 拒绝写入，SHOULD 仍能读取）。
# 读命令（ls / show / prime / doctor / web）照常，并在 stderr 提示版本更高；每个写命令退出 4，账本与租约目录一个字节不变。

set -u
unset CLAUDECODE CODEX_THREAD_ID GEMINI_CLI OPENCODE PI_SESSION_ID CURSOR_AGENT TODOPI_AGENT TODOPI_ACTOR
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

TMP="$(mktemp -d)"
PIDS=""
trap 'for p in $PIDS; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; rm -rf "$TMP"' EXIT
cli() { if [ -n "${TODOPI_E2E_BIN:-}" ]; then "$TODOPI_E2E_BIN" "$@"; else node "$ROOT/src/cli.ts" "$@"; fi; }

W="$TMP/w"
mkdir -p "$W"
git -C "$W" init -q
git -C "$W" config user.name tester
cli -C "$W" init >/dev/null 2>&1
A="$(cli -C "$W" add "in progress" --ac "one" | head -1 | cut -d' ' -f1)"
B="$(cli -C "$W" add "open" | head -1 | cut -d' ' -f1)"
C="$(cli -C "$W" add "closed" | head -1 | cut -d' ' -f1)"
cli -C "$W" claim "$A" >/dev/null 2>&1
cli -C "$W" close "$C" --resolution obsolete >/dev/null 2>&1
sed 's/^version: 1$/version: 2/' "$W/.todopi/config.yml" > "$TMP/c" && cat "$TMP/c" > "$W/.todopi/config.yml"
grep -q "^version: 2$" "$W/.todopi/config.yml" || fail "没能把账本改成 version 2"

snapshot() { (cd "$W" && find .todopi .git/todopi AGENTS.md -type f 2>/dev/null | LC_ALL=C sort | xargs shasum 2>/dev/null); }
before="$(snapshot)"

# 读：照常，stderr 有一句版本更高的提示
for c in "ls" "ls --json" "show $A" "show $A --full" "prime" "doctor"; do
  out="$(cli -C "$W" $c 2>"$TMP/err")"; rc=$?
  [ "$rc" -eq 0 ] && [ -n "$out" ] && grep -q "format version 2, newer than this todopi supports (1)" "$TMP/err" \
    && ok "读命令 ${c}：可用，提示版本更高" || fail "${c}：rc=${rc} out=${out} err=$(cat "$TMP/err")"
done
cli -C "$W" ls --json 2>/dev/null | jq -e 'type == "array" and length >= 2' >/dev/null && ok "ls --json 的 stdout 仍是可解析的 JSON（提示只在 stderr）" || fail "ls --json 不可解析"
cli -C "$W" show "$A" 2>/dev/null | grep -q "status     in progress" && ok "show 读出的状态照旧" || fail "$(cli -C "$W" show "$A" 2>&1)"
err="$(cli -C "$W" --quiet ls 2>&1 >/dev/null)"
[ -z "$err" ] && ok "--quiet：不提示" || fail "--quiet 仍有：$err"

PORT="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
SERVE="$TMP/serve"
if [ -n "${TODOPI_E2E_BIN:-}" ]; then printf '#!/bin/sh\nexec "%s" "$@"\n' "$TODOPI_E2E_BIN"; else printf '#!/bin/sh\nexec node "%s/src/cli.ts" "$@"\n' "$ROOT"; fi > "$SERVE"; chmod +x "$SERVE"
"$SERVE" -C "$W" web --port "$PORT" > "$TMP/web.out" 2>&1 &
PIDS="$PIDS $!"
page=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  page="$(curl -s "http://127.0.0.1:$PORT/" 2>/dev/null)" && [ -n "$page" ] && break
  node -e 'setTimeout(()=>{},250)'
done
printf '%s' "$page" | grep -q "in progress" && grep -q "format version 2" "$TMP/web.out" && ok "web：看板可用，启动时提示版本更高" || fail "web：$(cat "$TMP/web.out")"

# 写：每个都退出 4，什么都不写
printf -- '- [ ] imported\n' > "$TMP/plan.md"
while IFS= read -r c; do
  [ -z "$c" ] && continue
  out="$(cli -C "$W" $c 2>&1)"; rc=$?
  [ "$rc" -eq 4 ] && printf '%s' "$out" | grep -q "can read the ledger but not change it" && [ "$(snapshot)" = "$before" ] \
    && ok "写命令 ${c}：退出 4，什么都没写" || fail "${c}：rc=${rc}：$out"
done <<LIST
add new-task
note $A text
check $A 1
edit $A --title renamed
move $B --top
dep add $B --on $A
claim $B
release $A
done $A --yes
close $B --resolution obsolete
reopen $C
handoff
import $TMP/plan.md
doctor --fix
init
LIST

exit "$FAILED"
