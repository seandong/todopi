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

# 1. 跑完：TMPDIR 里什么都不剩。环境里带一个假的 HARNESS_TMP / _PRIVATE_TMP 也不能让它跳过隔离（Codex 评审）
mkdir -p "$OUTER/a" "$OUTER/decoy"
TMPDIR="$OUTER/a" HARNESS_TMP="$OUTER/decoy" _PRIVATE_TMP="$OUTER/decoy" bash tools/harness.sh test >"$OUTER/a.log" 2>&1; rc=$?
left="$(ls -A "$OUTER/a")"
[ "$rc" -eq 0 ] && [ -z "$left" ] && [ -z "$(ls -A "$OUTER/decoy")" ] && ok "test 层跑完，TMPDIR 里没有留下任何东西（环境里的假变量不起作用）" \
  || fail "rc=${rc}；留下：$(printf '%s' "$left" | head -5 | tr '\n' ' ')；decoy：$(ls -A "$OUTER/decoy" | head -3 | tr '\n' ' ')；$(tail -3 "$OUTER/a.log")"

# 2. 中途打断：像终端里的 Ctrl-C 那样给整个进程组发 SIGINT（后台启动的 bash 会忽略单独发给它的 SIGINT——评审一轮的假绿）。
#    要求它真的提前停了（退出 130、没跑到 overall 那一行），而且私有目录删掉了
mkdir -p "$OUTER/b"
set -m
TMPDIR="$OUTER/b" bash tools/harness.sh test >"$OUTER/b.log" 2>&1 &
pid=$!
set +m
i=0
while [ "$i" -lt 100 ] && ! ls "$OUTER/b" 2>/dev/null | grep -q '^todopi-harness\.'; do node -e 'setTimeout(()=>{},100)'; i=$((i + 1)); done
ls "$OUTER/b" | grep -q '^todopi-harness\.' || fail "等不到 harness 建私有目录"
node -e 'setTimeout(()=>{},3000)'
t0=$(node -e 'console.log(Date.now())')
kill -INT -- "-$pid" 2>/dev/null
wait "$pid"; rc=$?
elapsed=$(( $(node -e 'console.log(Date.now())') - t0 ))
# 被打断时 harness 先停孤儿、改名后删，删不净就在后台重试：要的是「最终什么都不剩」，给它 30 秒（负载高时 5 秒不够，曾偶发失败）
i=0; while [ "$i" -lt 300 ] && [ -n "$(ls -A "$OUTER/b")" ]; do node -e 'setTimeout(()=>{},100)'; i=$((i + 1)); done
if [ "$rc" -eq 130 ] && ! grep -q "overall" "$OUTER/b.log" && [ "$elapsed" -lt 20000 ] && [ -z "$(ls -A "$OUTER/b")" ]; then
  ok "Ctrl-C 真的打断了（退出 130，${elapsed} ms 内停下），私有目录也删掉了"
else
  fail "rc=${rc}，打断后 ${elapsed} ms；overall：$(grep -c overall "$OUTER/b.log")；留下：$(ls -A "$OUTER/b" | head -5 | tr '\n' ' ')"
fi

exit "$FAILED"
