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
cli -C "$W" prime --session s1 --mark-compacted >/dev/null 2>&1
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
cli -C "$W" prime --session s1 --if-compacted >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(snapshot)" = "$before" ] && ls "$W"/.git/todopi/leases/sessions/*.compacted >/dev/null 2>&1 \
  && ok "prime --if-compacted：不取走压缩标记（取走也是写）" || fail "rc=${rc}；压缩标记被动了"
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

# 等锁期间账本被升版（Codex 评审实测）：旧版本进程拿到锁之后要按磁盘上此刻的版本再判一次
R="$TMP/race"
mkdir -p "$R"
git -C "$R" init -q
git -C "$R" config user.name tester
cli -C "$R" init >/dev/null 2>&1
RT="$(cli -C "$R" add "to claim" | head -1 | cut -d' ' -f1)"
LOCK="$(git -C "$R" rev-parse --absolute-git-dir)/todopi/leases/lock"
mkdir -p "$(dirname "$LOCK")"
printf '{"pid":%s,"host":"%s","at":"2026-01-01T00:00:00Z","nonce":"held-by-e2e"}' "$$" "$(hostname)" > "$LOCK"
# claim 先写租约、再写任务文件：只有「拿到锁之后再判一次」挡得住租约
# 握手：子进程每试一次拿锁都会在租约目录里建、删一个临时文件，目录的 mtime 变了，就说明它已经过了锁前的那次判断、
# 正在等锁（固定睡一段时间证明不了这一点：子进程起得慢时锁前那次就挡住了，测不到锁内那次——Codex 复审实测的假绿）
mt() { node -e 'console.log(require("fs").statSync(process.argv[1]).mtimeMs)' "$1"; }
base="$(mt "$(dirname "$LOCK")")"
cli -C "$R" claim "$RT" > "$TMP/race.out" 2>&1 &
RP=$!
node -e '
  const fs = require("fs"), [d, base] = process.argv.slice(1), t0 = Date.now();
  (function wait() {
    if (String(fs.statSync(d).mtimeMs) !== base) process.exit(0);
    if (Date.now() - t0 > 4000) process.exit(1);
    setTimeout(wait, 5);
  })();' "$(dirname "$LOCK")" "$base" || fail "握手超时：子进程没有进入等锁"
sed 's/^version: 1$/version: 2/' "$R/.todopi/config.yml" > "$TMP/c2" && cat "$TMP/c2" > "$R/.todopi/config.yml"
rm -f "$LOCK"
wait "$RP"; rc=$?
[ "$rc" -eq 4 ] && [ ! -e "$(dirname "$LOCK")/$RT.json" ] && cli -C "$R" --quiet show "$RT" | grep -q "status     open" \
  && ok "等锁期间被升版：claim 拿到锁后退出 4，租约与任务都没写" || fail "rc=${rc}：$(cat "$TMP/race.out")；leases=$(ls "$(dirname "$LOCK")")"

exit "$FAILED"
