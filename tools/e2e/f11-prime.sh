#!/usr/bin/env bash
# tools/e2e/f11-prime.sh —— F11 的 Layer 3。
# 裁剪顺序、白名单、会话键由 commands/ 的用例覆盖；这里验证 CLI 真的接通了：真 git 仓库里会话文件
# 落在 .git/todopi/leases/sessions/、跑完工作区干净、--json 与文本是同样的内容、--budget 的解析。

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
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=eval("JSON.parse(s)"+process.argv[1]);process.stdout.write(typeof v==="string"?v:JSON.stringify(v))})' "$1"; }

W="$TMP/w"
mkdir -p "$W"
git -C "$W" init -q
git -C "$W" config user.name t; git -C "$W" config user.email t@e
cli -C "$W" init >/dev/null 2>&1
T="$(cli -C "$W" --as me@h --json add "the task" --ac "first box" --ac "second box" 2>/dev/null | jget '.id')"
cli -C "$W" --as me@h add "another" >/dev/null 2>&1
[ -n "$T" ] || { fail "夹具没建起来"; echo "f11-prime: fail"; exit 1; }
git -C "$W" add -A && git -C "$W" commit -qm fixtures

# 1. 没有持有的任务：单行
out="$(cli -C "$W" --as me@h prime 2>/dev/null)"; rc=$?
[ "$rc" -eq 0 ] && [ "$out" = 'No task in progress · 2 ready: `todopi ls --ready`' ] \
  && ok "没有持有的任务：单行" || fail "rc=$rc 输出：$out"

# 2. 持有之后：推送当前任务，指针在最后一行
cli -C "$W" --as me@h claim "$T" >/dev/null 2>&1
git -C "$W" add -A && git -C "$W" commit -qm claim
out="$(cli -C "$W" --as me@h prime --session "sess-1" 2>/dev/null)"; rc=$?
first="$(printf '%s\n' "$out" | head -1)"
last="$(printf '%s\n' "$out" | tail -1)"
[ "$rc" -eq 0 ] && [ "$first" = "## $T: the task" ] && ok "第一行是当前任务" || fail "第一行是：$first"
case "$last" in
  '1 ready (`todopi ls --ready`) · everything else: `todopi prime --full`') ok "最后一行是指针" ;;
  *) fail "最后一行是：$last" ;;
esac
printf '%s\n' "$out" | grep -q '^- \[ \] 1\. first box$' && ok "带编号与状态的标准" || fail "没有找到标准行"

# 3. 会话文件落在运行时目录；工作区干净（prime 不写 .todopi/）
n="$(ls "$W/.git/todopi/leases/sessions/" 2>/dev/null | wc -l | tr -d ' ')"
grep -q '"key":"session:sess-1"' "$W"/.git/todopi/leases/sessions/*.json 2>/dev/null \
  && ok "会话文件在 .git/todopi/leases/sessions/（共 ${n} 个）" || fail "没找到 session:sess-1 的会话文件"
[ -z "$(git -C "$W" status --porcelain)" ] && ok "prime 之后工作区干净" || fail "prime 改了工作区：$(git -C "$W" status --porcelain)"

# 4. --json 是同样的内容
js="$(cli -C "$W" --as me@h --json prime 2>/dev/null)"
[ "$(printf '%s' "$js" | jget '.held[0].id')" = "$T" ] && [ "$(printf '%s' "$js" | jget '.ready')" = "1" ] \
  && [ "$(printf '%s' "$js" | jget '.held[0].acceptance.length')" = "2" ] \
  && ok "--json：同一个任务、同样的计数与标准" || fail "--json 输出：$js"
txt="$(cli -C "$W" --as me@h prime 2>/dev/null | tail -1)"
[ "$(printf '%s' "$js" | jget '.pointer')" = "$txt" ] && ok "--json 的 pointer 与文本最后一行逐字相同" \
  || fail "pointer 不同：$(printf '%s' "$js" | jget '.pointer') / $txt"

# 5. --budget 的解析；--full 的各节
cli -C "$W" prime --budget 0x10 >/dev/null 2>&1; rc=$?
[ "$rc" -eq 1 ] && ok "--budget 0x10 退出 1" || fail "--budget 0x10 退出 $rc"
full="$(cli -C "$W" --as me@h prime --full 2>/dev/null)"
for h in "# In progress (yours)" "# Held by others" "# Ready" "# Counts" "# Recently closed"; do
  printf '%s\n' "$full" | grep -qx "$h" || fail "--full 缺少 ${h}"
done
ok "--full 的五节都在"

[ "$FAILED" -eq 0 ] && { echo "f11-prime: pass"; exit 0; } || { echo "f11-prime: fail"; exit 1; }
