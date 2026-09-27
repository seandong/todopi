#!/usr/bin/env bash
# tools/e2e/f31-private-tmp.sh —— F31 的 Layer 3：make test / make e2e 不在系统临时目录里留垃圾。
# 在一个全新的 TMPDIR 下跑一遍 test 层：结束后那里什么都不剩（单测建的临时目录都在 harness 的私有目录里，随它删掉）；
# 再跑一遍、中途 Ctrl-C：私有目录照样删掉。不跑 e2e 层——那会递归到本脚本自己。

set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

OUTER="$(mktemp -d)"
trap 'rm -rf "$OUTER"' EXIT

# 1. 跑完：TMPDIR 里什么都不剩
mkdir -p "$OUTER/a"
TMPDIR="$OUTER/a" HARNESS_TMP= bash tools/harness.sh test >"$OUTER/a.log" 2>&1; rc=$?
left="$(ls -A "$OUTER/a")"
[ "$rc" -eq 0 ] && [ -z "$left" ] && ok "test 层跑完，TMPDIR 里没有留下任何东西" \
  || fail "rc=${rc}；留下：$(printf '%s' "$left" | head -5 | tr '\n' ' ')；$(tail -3 "$OUTER/a.log")"

# 2. 中途打断：私有目录照样删掉
mkdir -p "$OUTER/b"
TMPDIR="$OUTER/b" HARNESS_TMP= bash tools/harness.sh test >"$OUTER/b.log" 2>&1 &
pid=$!
i=0
while [ "$i" -lt 100 ] && ! ls "$OUTER/b" 2>/dev/null | grep -q '^todopi-harness\.'; do node -e 'setTimeout(()=>{},100)'; i=$((i + 1)); done
ls "$OUTER/b" | grep -q '^todopi-harness\.' || fail "等不到 harness 建私有目录"
node -e 'setTimeout(()=>{},1500)'
kill -INT "$pid" 2>/dev/null
wait "$pid" 2>/dev/null
# 被打断的 node 子进程可能还在收尾；给它一点时间
i=0; while [ "$i" -lt 50 ] && [ -n "$(ls -A "$OUTER/b")" ]; do node -e 'setTimeout(()=>{},100)'; i=$((i + 1)); done
[ -z "$(ls -A "$OUTER/b")" ] && ok "Ctrl-C 打断后私有目录也删掉了" || fail "打断后留下：$(ls -A "$OUTER/b" | head -5 | tr '\n' ' ')"

exit "$FAILED"
