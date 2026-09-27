#!/usr/bin/env bash
# tools/e2e/f26-trust-prompt.sh —— F26 的 Layer 3：首次执行 verify 的确认（FR-D4）。
# 有终端（经 script(1) 给一个伪终端，真的从键盘那一侧输入答案）：答 y 执行并记住信任，答 n 什么都不做；
# 没有终端（agent 在管道里调用）照旧拒绝并提示 --yes；--yes 与 CI=true 照旧跳过确认。

set -u
unset CLAUDECODE CODEX_THREAD_ID GEMINI_CLI OPENCODE PI_SESSION_ID CURSOR_AGENT TODOPI_AGENT TODOPI_ACTOR CI
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cli() { if [ -n "${TODOPI_E2E_BIN:-}" ]; then "$TODOPI_E2E_BIN" "$@"; else node "$ROOT/src/cli.ts" "$@"; fi; }
export TODOPI_CONFIG_DIR="$TMP/config"
TRUST="$TODOPI_CONFIG_DIR/todopi/trust"

# 在伪终端里跑一条 todopi 命令，把 $1 当作键盘输入。BSD 与 util-linux 的 script 参数不同。
RUNNER="$TMP/run.sh"
if [ -n "${TODOPI_E2E_BIN:-}" ]; then printf '#!/bin/sh\n"%s" "$@"\necho "rc=$?" > "$RC_FILE"\n' "$TODOPI_E2E_BIN"
else printf '#!/bin/sh\nnode "%s/src/cli.ts" "$@"\necho "rc=$?" > "$RC_FILE"\n' "$ROOT"; fi > "$RUNNER"
chmod +x "$RUNNER"
# 答案要等提示出现之后再「敲」：一开始就把答案连同 EOF 灌进去，BSD 的 script 会先把 EOF（^D）送到终端，答案就丢了。
# 敲完再等一会儿才关管道（关管道 = 终端上的 EOF）；命令先结束（没问）也就不用再等。
pause() { node -e "setTimeout(()=>{},$1)"; }
feed() {
  local i=0
  while [ "$i" -lt 150 ]; do
    grep -q "\[y/N\]" "$TMP/pty.out" 2>/dev/null && break
    [ -e "$RC_FILE" ] && return 0
    pause 100; i=$((i + 1))
  done
  printf '%s' "$1"
  i=0; while [ "$i" -lt 100 ] && [ ! -e "$RC_FILE" ]; do pause 100; i=$((i + 1)); done
}
in_pty() {
  local input="$1"; shift
  RC_FILE="$TMP/rc"; export RC_FILE; rm -f "$RC_FILE" "$TMP/pty.out"; : > "$TMP/pty.out"
  if script -V >/dev/null 2>&1; then
    local q=""; for a in "$@"; do q="$q '$(printf '%s' "$a" | sed "s/'/'\\\\''/g")'"; done
    feed "$input" | script -qfec "$RUNNER$q" /dev/null > "$TMP/pty.out" 2>&1
  else
    feed "$input" | script -q /dev/null "$RUNNER" "$@" > "$TMP/pty.out" 2>&1
  fi
  sed 's/^rc=//' "$RC_FILE" 2>/dev/null || echo "none"
}

W="$TMP/w"
mkdir -p "$W"
git -C "$W" init -q
git -C "$W" config user.name tester
cli -C "$W" init >/dev/null 2>&1
mk() { cli -C "$W" add "$1" --verify "$2" | head -1 | cut -d' ' -f1; }

# 没有终端：照旧拒绝，提示 --yes，不跑、不记
A="$(mk "no tty" "touch $TMP/ran-a")"
out="$(cli -C "$W" done "$A" 2>&1 </dev/null)"; rc=$?
[ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q -- "--yes" && [ ! -e "$TMP/ran-a" ] && [ ! -e "$TRUST" ] \
  && ok "没有终端：退出 2，提示 --yes，verify 没跑，没记信任" || fail "rc=${rc}：$out"

if ! command -v script >/dev/null 2>&1; then
  fail "没有 script(1)，无法在伪终端里验证确认"
else
  # 有终端、答 n
  rc="$(in_pty "n
" -C "$W" done "$A")"
  [ "$rc" = "2" ] && grep -q "touch $TMP/ran-a" "$TMP/pty.out" && grep -q "\[y/N\]" "$TMP/pty.out" && grep -q "Not approved" "$TMP/pty.out" \
    && [ ! -e "$TMP/ran-a" ] && [ ! -e "$TRUST" ] && cli -C "$W" show "$A" | grep -q "status     open" \
    && ok "有终端、答 n：给出命令问一次，退出 2，什么都没做" || fail "rc=${rc}：$(cat "$TMP/pty.out")"

  # 有终端、答 y
  rc="$(in_pty "y
" -C "$W" done "$A")"
  [ "$rc" = "0" ] && [ -e "$TMP/ran-a" ] && grep -q "$(cd "$W" && pwd -P)" "$TRUST" && cli -C "$W" show "$A" | grep -q "status     done" \
    && ok "有终端、答 y：执行、关闭、记住信任" || fail "rc=${rc}：$(cat "$TMP/pty.out")；trust=$(cat "$TRUST" 2>/dev/null)"

  # 记住了：下一个任务在终端里也不再问
  B="$(mk "second" "touch $TMP/ran-b")"
  rc="$(in_pty "" -C "$W" done "$B")"
  [ "$rc" = "0" ] && [ -e "$TMP/ran-b" ] && ! grep -q "\[y/N\]" "$TMP/pty.out" && ok "已信任：不再问" || fail "rc=${rc}：$(cat "$TMP/pty.out")"
fi

# --yes 与 CI=true：照旧跳过确认（新的配置目录 = 未信任）
export TODOPI_CONFIG_DIR="$TMP/config2"
C="$(mk "yes" "touch $TMP/ran-c")"
cli -C "$W" done "$C" --yes >/dev/null 2>&1 </dev/null && [ -e "$TMP/ran-c" ] && ok "--yes：不问，执行并记住" || fail "--yes 失败"
export TODOPI_CONFIG_DIR="$TMP/config3"
D="$(mk "ci" "touch $TMP/ran-d")"
CI=true cli -C "$W" done "$D" >/dev/null 2>&1 </dev/null && [ -e "$TMP/ran-d" ] && ok "CI=true：不问，执行" || fail "CI=true 失败"

exit "$FAILED"
