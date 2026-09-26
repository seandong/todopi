#!/usr/bin/env bash
# tools/e2e/f14-setup-claude.sh —— F14 的 Layer 3。
# 合并与幂等的细节由 commands/ 的用例覆盖；这里验证 CLI 真的接通了：setup 写出的钩子命令真能跑——
# 喂一份 Claude Code 形状的钩子载荷，prime 按载荷里的 session_id 记下会话；没有账本的目录里静默退出 0。
# 「Claude Code 真的把输出放进上下文」要真的 agent，在 PRD §17 记了 2026-09-26 的实测，不在这里跑。

set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# 钩子里写的是 `todopi …`：放一个指向本仓库 CLI 的 shim 到 PATH 最前面。
mkdir -p "$TMP/bin"
printf '#!/bin/sh\nexec node %s/src/cli.ts "$@"\n' "$ROOT" > "$TMP/bin/todopi"
chmod +x "$TMP/bin/todopi"
export PATH="$TMP/bin:$PATH"

W="$TMP/w"
mkdir -p "$W"
git -C "$W" init -q
todopi -C "$W" init >/dev/null 2>&1

# 1. setup：两个文件，第二次什么都不改
out="$(todopi -C "$W" setup claude 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -q "^created .*/.claude/settings.json$" && printf '%s\n' "$out" | grep -q "^created .*/CLAUDE.md$" \
  && ok "setup 写出 settings.json 与 CLAUDE.md" || fail "rc=${rc}：$out"
snap="$(cat "$W/.claude/settings.json")"
out="$(todopi -C "$W" setup claude 2>&1)"
[ "$(cat "$W/.claude/settings.json")" = "$snap" ] && [ "$(printf '%s\n' "$out" | grep -c '^unchanged')" = "2" ] && ok "再跑一次：两个都 unchanged" || fail "不幂等：$out"

# 2. 照 settings.json 里写的命令，喂 Claude Code 形状的载荷去跑
cmd="$(node -e 'const s=require(process.argv[1]);console.log(s.hooks.SessionStart[0].hooks[0].command)' "$W/.claude/settings.json")"
[ "$cmd" = "todopi prime --hook" ] && ok "SessionStart 钩子命令是 todopi prime --hook" || fail "钩子命令是：$cmd"
payload='{"session_id":"e2e-sess-1","hook_event_name":"SessionStart","source":"compact","cwd":"'"$W"'"}'
out="$(cd "$W" && printf '%s' "$payload" | sh -c "$cmd" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s\n' "$out" | tail -1 | grep -q "^No task in progress" && ok "钩子命令跑通，输出 prime" || fail "rc=${rc}：$out"
grep -q '"key":"session:e2e-sess-1"' "$W"/.git/todopi/leases/sessions/*.json 2>/dev/null && ok "按载荷里的 session_id 记下会话" || fail "没按 session_id 记"
end="$(node -e 'const s=require(process.argv[1]);console.log(s.hooks.SessionEnd[0].hooks[0].command)' "$W/.claude/settings.json")"
out="$(cd "$W" && printf '%s' '{"session_id":"e2e-sess-1","hook_event_name":"SessionEnd","reason":"other"}' | sh -c "$end" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -q "last prime: 20" && ok "SessionEnd 命令跑通，找到了这个会话的 prime" || fail "rc=${rc}：$out"

# 3. 没有账本的目录（用户级钩子会在每个项目里触发）：静默、退出 0
E="$TMP/empty"; mkdir -p "$E"
out="$(cd "$E" && printf '%s' "$payload" | todopi prime --hook 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "没有账本：prime --hook 静默退出 0" || fail "rc=$rc 输出：$out"
out="$(cd "$E" && printf '%s' "$payload" | todopi handoff --check --hook 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "没有账本：handoff --hook 静默退出 0" || fail "rc=$rc 输出：$out"

[ "$FAILED" -eq 0 ] && { echo "f14-setup-claude: pass"; exit 0; } || { echo "f14-setup-claude: fail"; exit 1; }
