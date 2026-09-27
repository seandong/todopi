#!/usr/bin/env bash
# tools/e2e/f23-cli-surface.sh —— F23 的 Layer 3：审计补齐的 CLI 表面。
# FR-Q4 的别名（list、new / create、log、block）；close --reason 不用 --force；--quiet 在 setup / import / web 上只留结果；
# done 因验收标准被拒时给的是 todopi check，而且照着跑就能通过。

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

# 别名
A="$(cli -C "$W" new "via new" | head -1 | cut -d' ' -f1)"
B="$(cli -C "$W" create "via create" | head -1 | cut -d' ' -f1)"
[ -n "$A" ] && [ -n "$B" ] && [ "$(cli -C "$W" list | wc -l | tr -d ' ')" = "2" ] && ok "new / create / list 都可用" || fail "new=$A create=$B list=$(cli -C "$W" list)"
cli -C "$W" log "$A" "via log" >/dev/null 2>&1 && cli -C "$W" show "$A" --full | grep -q "via log" && ok "log 是 note 的别名" || fail "log 不可用"
cli -C "$W" block add "$B" --on "$A" >/dev/null 2>&1 && cli -C "$W" show "$B" | grep -q "blocked_by $A" && ok "block 是 dep 的别名" || fail "block 不可用：$(cli -C "$W" show "$B")"

# close --reason 不用 --force
out="$(cli -C "$W" close "$B" --resolution obsolete --reason "superseded" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && cli -C "$W" show "$B" --full | grep -q "closed resolution=obsolete: superseded" && ok "close --reason 不配 --force 也行，理由进 Log" || fail "rc=${rc}：$out"

# done 被拒：给的是 todopi check，照着跑就能 done
C="$(cli -C "$W" add "with criteria" --ac "first" --ac "second" | head -1 | cut -d' ' -f1)"
cli -C "$W" claim "$C" >/dev/null 2>&1
out="$(cli -C "$W" done "$C" --yes 2>&1)"; rc=$?
cmds="$(printf '%s\n' "$out" | grep -oE "todopi check $C [0-9]+")"
[ "$rc" -eq 2 ] && [ "$(printf '%s\n' "$cmds" | wc -l | tr -d ' ')" = "2" ] && ! printf '%s' "$out" | grep -q ".todopi/tasks/" \
  && ok "done 被拒：每条没勾的标准一条 todopi check，不再叫人改文件" || fail "rc=${rc}：$out"
printf '%s\n' "$cmds" | while read -r c; do cli -C "$W" ${c#todopi } >/dev/null 2>&1; done
cli -C "$W" done "$C" --yes >/dev/null 2>&1 && ok "照着报告里的 check 命令勾完，done 通过" || fail "勾完仍 done 不了"

# --quiet
out="$(cli -C "$W" --quiet setup codex 2>&1)"
[ -n "$out" ] && ! printf '%s' "$out" | grep -qi "trust" && printf '%s' "$out" | grep -q "hooks.json" && ok "setup --quiet：只有写了哪些文件，没有信任提示" || fail "$out"
printf -- '- [ ] one\n' > "$W/plan.md"
out="$(cli -C "$W" --quiet import "$W/plan.md" 2>&1)"
printf '%s' "$out" | grep -q "^Imported 1 task" && ! printf '%s' "$out" | grep -q "Next:" && ok "import --quiet：没有 Next 提示" || fail "$out"
PORT="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
SERVE="$TMP/serve"
if [ -n "${TODOPI_E2E_BIN:-}" ]; then printf '#!/bin/sh\nexec "%s" "$@"\n' "$TODOPI_E2E_BIN"; else printf '#!/bin/sh\nexec node "%s/src/cli.ts" "$@"\n' "$ROOT"; fi > "$SERVE"; chmod +x "$SERVE"
"$SERVE" -C "$W" --quiet web --port "$PORT" > "$TMP/web.out" 2>&1 &
PIDS="$PIDS $!"
for _ in $(seq 1 50); do grep -q "todopi board:" "$TMP/web.out" 2>/dev/null && break; sleep 0.1; done
[ "$(wc -l < "$TMP/web.out" | tr -d ' ')" = "1" ] && ! grep -q "Ctrl+C" "$TMP/web.out" && ok "web --quiet：只有地址" || fail "$(cat "$TMP/web.out")"

[ "$FAILED" -eq 0 ] && { echo "f23-cli-surface: pass"; exit 0; } || { echo "f23-cli-surface: fail"; exit 1; }
