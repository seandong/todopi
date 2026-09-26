#!/usr/bin/env bash
# tools/e2e/f18-web.sh —— F18 的 Layer 3。
# 服务器与页面的细节由 commands/ 的用例覆盖；这里起真的 `todopi web` 进程：页面、SSE 推送、只读、Host 校验、
# 端口被占用、非法端口、没有账本，以及终端关掉（SIGHUP）后进程不残留。

set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

TMP="$(mktemp -d)"
PIDS=""
cleanup() { for p in $PIDS; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT
todopi() { if [ -n "${TODOPI_E2E_BIN:-}" ]; then "$TODOPI_E2E_BIN" "$@"; else node "$ROOT/src/cli.ts" "$@"; fi; }
free_port() { node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
wait_for() { # wait_for <file> <pattern> <tries>
  local i=0
  while [ "$i" -lt "$3" ]; do grep -q "$2" "$1" 2>/dev/null && return 0; sleep 0.1; i=$((i + 1)); done
  return 1
}

# 起服务用的 shim：exec 替换掉 sh，后台时 $! 就是服务进程本身（SIGHUP 与 lsof 都要打在它身上）
SERVE="$TMP/serve"
if [ -n "${TODOPI_E2E_BIN:-}" ]; then printf '#!/bin/sh\nexec "%s" "$@"\n' "$TODOPI_E2E_BIN"; else printf '#!/bin/sh\nexec node "%s/src/cli.ts" "$@"\n' "$ROOT"; fi > "$SERVE"
chmod +x "$SERVE"

W="$TMP/w"
mkdir -p "$W"
git -C "$W" init -q
todopi -C "$W" init >/dev/null 2>&1
todopi -C "$W" add "First board task" >/dev/null 2>&1

PORT="$(free_port)"
"$SERVE" -C "$W" web --port "$PORT" > "$TMP/web.out" 2>&1 &
WEB=$!
PIDS="$PIDS $WEB"
wait_for "$TMP/web.out" "todopi board: http://127.0.0.1:${PORT}/" 50 && ok "web 起来并打印地址" || fail "$(cat "$TMP/web.out")"

page="$(curl -s "http://127.0.0.1:${PORT}/")"
printf '%s' "$page" | grep -q "new EventSource" && ok "GET / 给页面" || fail "页面不对"
[ "$(printf '%s' "$page" | grep -cE 'https?://')" = "0" ] && ok "页面不引用任何外部 URL" || fail "页面里有外链"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${PORT}/")" = "405" ] && ok "只读：POST 405" || fail "POST 没被拒"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Host: evil.example:${PORT}" "http://127.0.0.1:${PORT}/")" = "403" ] \
  && ok "Host 不是回环地址：403（DNS rebinding）" || fail "伪造的 Host 没被拒"
if command -v lsof >/dev/null 2>&1; then
  lsof -nP -a -p "$WEB" -iTCP -sTCP:LISTEN 2>/dev/null | grep -q "127.0.0.1:${PORT}" && ! lsof -nP -a -p "$WEB" -iTCP -sTCP:LISTEN 2>/dev/null | grep -qE '\*:|0\.0\.0\.0:' \
    && ok "只监听 127.0.0.1" || fail "$(lsof -nP -a -p "$WEB" -iTCP -sTCP:LISTEN 2>&1)"
fi

curl -s -N "http://127.0.0.1:${PORT}/events" > "$TMP/sse.out" &
PIDS="$PIDS $!"
wait_for "$TMP/sse.out" "First board task" 50 && ok "SSE 先推一份全量" || fail "SSE 没有首推：$(head -c 200 "$TMP/sse.out")"
todopi -C "$W" add "Second board task" >/dev/null 2>&1
wait_for "$TMP/sse.out" "Second board task" 50 && ok "文件变化后经 SSE 推送" || fail "改了账本没推送"

out="$(todopi -C "$W" web --port "$PORT" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q -- "--port" && ! printf '%s' "$out" | grep -q "todopi board:" \
  && ok "端口被占用：退出 1、提示 --port、不换端口" || fail "rc=${rc}：$out"

out="$(todopi -C "$W" web --port 0x10 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "非法 --port 退出 1" || fail "rc=${rc}：$out"
mkdir -p "$TMP/none"
out="$(todopi -C "$TMP/none" web --port "$(free_port)" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && ! printf '%s' "$out" | grep -q "todopi board:" && ok "没有账本：不起服务、非零退出" || fail "rc=${rc}：$out"

# 轮询模式同样推送
P2="$(free_port)"
"$SERVE" -C "$W" web --port "$P2" --poll > "$TMP/web2.out" 2>&1 &
WEB2=$!
PIDS="$PIDS $WEB2"
wait_for "$TMP/web2.out" "polling" 50 && ok "--poll 以轮询方式运行" || fail "$(cat "$TMP/web2.out")"
curl -s -N "http://127.0.0.1:${P2}/events" > "$TMP/sse2.out" &
PIDS="$PIDS $!"
wait_for "$TMP/sse2.out" "Second board task" 50 || fail "轮询模式没有首推"
todopi -C "$W" add "Third board task" >/dev/null 2>&1
wait_for "$TMP/sse2.out" "Third board task" 50 && ok "轮询模式下文件变化照样推送" || fail "轮询模式没推送"

# 终端关掉：SIGHUP 的默认行为就是结束进程
kill -HUP "$WEB" "$WEB2" 2>/dev/null
wait "$WEB" "$WEB2" 2>/dev/null
gone=1
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if kill -0 "$WEB" 2>/dev/null || kill -0 "$WEB2" 2>/dev/null; then gone=0; sleep 0.1; else gone=1; break; fi
done
[ "$gone" -eq 1 ] && ok "SIGHUP 后进程结束，不残留" || fail "SIGHUP 后进程还在"
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/")" = "000" ] && ok "端口已释放" || fail "端口还在响应"

[ -z "$(git -C "$W" status --porcelain -- .todopi | grep -v '^?? .todopi/$' | grep -vE '^\?\? .todopi/tasks/')" ] \
  && ok "看板没往 .todopi/ 写东西" || fail "$(git -C "$W" status --porcelain -- .todopi)"

[ "$FAILED" -eq 0 ] && { echo "f18-web: pass"; exit 0; } || { echo "f18-web: fail"; exit 1; }
