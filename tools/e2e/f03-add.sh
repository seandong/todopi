#!/usr/bin/env bash
# tools/e2e/f03-add.sh —— F03 的 Layer 3。
#
# 第 7 条是本 feature 的核心：20 个并发进程各跑一次 add。无锁时实测只产出 9 个
# 文件（D006 决策 5 把这条压测列为文件锁的真实成本）。它必须稳定，不得 flaky。
#
# 它也是唯一能抓到「把 readTasks 移出锁」这类错误的地方——单元测试是单进程的，
# 那个变异下 8 个用例全部通过。

set -u
# 与跑它的 agent 无关（F22）：agent 的环境信号会让默认身份变成 <agent>@<host>，脚本里的身份断言按 git 用户名写
unset CLAUDECODE CODEX_THREAD_ID GEMINI_CLI OPENCODE PI_SESSION_ID CURSOR_AGENT TODOPI_AGENT TODOPI_ACTOR
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cli() { if [ -n "${TODOPI_E2E_BIN:-}" ]; then "$TODOPI_E2E_BIN" "$@"; else node "$ROOT/src/cli.ts" "$@"; fi; }

# 1. add 之后 doctor 干净
mkdir -p "$TMP/basic"
cli -C "$TMP/basic" init >/dev/null 2>&1
if cli -C "$TMP/basic" add "feat: add login #42" >/dev/null 2>&1; then ok "add 退出 0"; else fail "add 应退出 0"; fi
if cli -C "$TMP/basic" doctor >/dev/null 2>&1; then ok "add 后 doctor 退出 0"; else fail "add 后 doctor 应退出 0"; fi

# 2. 标题原样保留（含冒号与 # 号——不加引号时这两样都会毁掉文件）
if grep -q 'title: "feat: add login #42"' "$TMP/basic"/.todopi/tasks/*.md; then
  ok "含冒号与 # 的标题原样保留"
else
  fail "标题未原样保留：$(grep '^title' "$TMP/basic"/.todopi/tasks/*.md)"
fi

# 3. rank 在创建时分配
grep -q '^rank: "' "$TMP/basic"/.todopi/tasks/*.md && ok "创建时分配了 rank" || fail "缺少 rank"

# 4. 空标题 → 1，且不留下文件
before=$(ls "$TMP/basic"/.todopi/tasks | wc -l | tr -d ' ')
cli -C "$TMP/basic" add "   " >/dev/null 2>&1
code=$?
[ "$code" -eq 1 ] && ok "空标题退出 1" || fail "应退出 1，实际 $code"
after=$(ls "$TMP/basic"/.todopi/tasks | wc -l | tr -d ' ')
[ "$before" -eq "$after" ] && ok "被拒绝的 add 未留下文件" || fail "文件数从 $before 变成 $after"

# 5. 输出是英文
out="$(cli -C "$TMP/basic" add "another task" 2>&1)"
if printf '%s' "$out" | node -e 'process.exit(/[\u4e00-\u9fff]/u.test(require("fs").readFileSync(0, "utf8")) ? 0 : 1)'; then
  fail "add 输出含中文（CLI 的 stdout 是产品表面，MUST 是英文）：$out"
else
  ok "add 输出是英文"
fi

# 6. --json 是合法 JSON
if cli -C "$TMP/basic" --json add "json task" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{JSON.parse(s)})' 2>/dev/null; then
  ok "--json 输出是合法 JSON"
else
  fail "--json 输出不是合法 JSON"
fi

# 7. 并发压测：20 个进程各跑一次 add
mkdir -p "$TMP/race"
cli -C "$TMP/race" init >/dev/null 2>&1
for i in $(seq 1 20); do cli -C "$TMP/race" add "concurrent task $i" >/dev/null 2>&1 & done
wait
n=$(ls "$TMP/race"/.todopi/tasks/*.md 2>/dev/null | wc -l | tr -d ' ')
[ "$n" -eq 20 ] && ok "20 个并发 add 产出 20 个文件" || fail "只产出 $n 个文件（无锁基线是 9）"

uniq_ids=$(ls "$TMP/race"/.todopi/tasks/ | sort -u | wc -l | tr -d ' ')
[ "$uniq_ids" -eq "$n" ] && ok "id 全部不同" || fail "有重复 id"

uniq_ranks=$(grep -h '^rank:' "$TMP/race"/.todopi/tasks/*.md | sort -u | wc -l | tr -d ' ')
[ "$uniq_ranks" -eq "$n" ] && ok "rank 全部不同" || fail "$n 个任务只有 $uniq_ranks 个不同的 rank"

if cli -C "$TMP/race" doctor >/dev/null 2>&1; then ok "并发之后 doctor 仍干净"; else fail "并发之后账本损坏"; fi

# 8. 锁文件在命令结束后不残留
lock_leftovers=$(find "$TMP/race" -name 'lock' -o -name '.lock.*.tmp' 2>/dev/null | wc -l | tr -d ' ')
[ "$lock_leftovers" -eq 0 ] && ok "无残留的锁文件" || fail "残留 $lock_leftovers 个锁文件"

# 9. 锁被占用时退出 3（FR-Q2：冲突），且错误信息给出可执行的补救命令
mkdir -p "$TMP/held"
cli -C "$TMP/held" init >/dev/null 2>&1
LOCK="$TMP/held/.todopi/.cache/lock"
mkdir -p "$(dirname "$LOCK")"
printf '{"pid":1,"host":"elsewhere","at":"2020-01-01T00:00:00Z","nonce":"x"}' > "$LOCK"
out="$(cli -C "$TMP/held" add "blocked" 2>&1)"; code=$?
[ "$code" -eq 3 ] && ok "锁被占用退出 3" || fail "应退出 3（FR-Q2），实际 $code"
case "$out" in
  *"Could not acquire the ledger lock"*) ok "错误信息点名了锁" ;;
  *) fail "错误信息没说清是锁的问题：$out" ;;
esac
rm -f "$LOCK"

[ "$FAILED" -eq 0 ] && { echo "f03-add: pass"; exit 0; } || { echo "f03-add: fail"; exit 1; }
