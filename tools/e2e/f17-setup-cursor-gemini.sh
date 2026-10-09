#!/usr/bin/env bash
# tools/e2e/f17-setup-cursor-gemini.sh —— F17 的 Layer 3。
# 配置合并由 commands/ 的用例覆盖；这里验证 CLI 接通：setup cursor / gemini 写出文件、幂等；钩子照 agent 的调用方式
# （载荷走 stdin）真能跑通——JSON 形状对、压缩标记只在 PreCompress 之后的下一轮生效一次。真 Gemini CLI 的实测记在 PRD §17。

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
mkdir -p "$TMP/bin"
if [ -n "${TODOPI_E2E_BIN:-}" ]; then printf '#!/bin/sh\nexec "%s" "$@"\n' "$TODOPI_E2E_BIN"; else printf '#!/bin/sh\nexec node %s/src/cli.ts "$@"\n' "$ROOT"; fi > "$TMP/bin/todopi"
chmod +x "$TMP/bin/todopi"
export PATH="$TMP/bin:$PATH"

W="$TMP/w"
mkdir -p "$W"
git -C "$W" init -q
todopi -C "$W" init >/dev/null 2>&1

# ---- Cursor ----
out="$(todopi -C "$W" setup cursor 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -q "^ *Created .cursor/hooks.json$" && printf '%s\n' "$out" | grep -q "^ *Created .cursor/rules/todopi.mdc$" \
  && ok "setup cursor 写出 hooks.json 与规则文件" || fail "rc=${rc}：$out"
[ "$(todopi -C "$W" setup cursor 2>&1 | grep -c '^ *Unchanged ')" = "2" ] && ok "setup cursor 幂等" || fail "setup cursor 不幂等"

out="$(cd "$W" && printf '{"conversation_id":"cur-1","hook_event_name":"sessionStart"}' | todopi prime --hook --hook-json cursor 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s' "$out" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));process.exit(/^No task in progress/.test(j.additional_context)?0:1)' \
  && ok "cursor 的 sessionStart：输出 {additional_context}" || fail "rc=${rc}：$out"
grep -q '"key":"session:cur-1"' "$W"/.git/todopi/leases/sessions/*.json 2>/dev/null && ok "按 conversation_id 记下会话" || fail "没按 conversation_id 记"

# Cursor 的用户级钩子在 ~/.cursor/ 里运行：按载荷的 workspace_roots 找到项目
out="$(cd "$TMP" && printf '{"conversation_id":"cur-2","workspace_roots":["%s"]}' "$W" | todopi prime --hook --hook-json cursor 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q '"additional_context"' && ok "不在项目里运行时按 workspace_roots 找到账本" || fail "rc=${rc}：$out"
out="$(cd "$TMP" && printf '{"conversation_id":"cur-2","workspace_roots":["%s"]}' "$W" | todopi handoff --check --hook --hook-json cursor 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s' "$out" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));process.exit(j&&typeof j==="object"&&!Array.isArray(j)?0:1)' \
  && ok "cursor 的 sessionEnd：按 workspace_roots 找到账本并输出有效 JSON" || fail "rc=${rc}：$out"

out="$(cd "$TMP" && printf '{"workspace_roots":["/nonexistent"]}' | todopi -C "$W" prime --hook --hook-json cursor 2>&1)"
printf '%s' "$out" | grep -q '"additional_context"' && ok "-C 优先于 workspace_roots" || fail "$out"

# ---- Gemini ----
out="$(todopi -C "$W" setup gemini 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -q "^ *Created .gemini/settings.json$" && ok "setup gemini 写出 settings.json" || fail "rc=${rc}：$out"
[ "$(todopi -C "$W" setup gemini 2>&1 | grep -c '^ *Unchanged ')" = "1" ] && ok "setup gemini 幂等" || fail "setup gemini 不幂等"

P='{"session_id":"gem-1","hook_event_name":"BeforeAgent"}'
hook() { (cd "$W" && printf '%s' "$P" | todopi prime --hook "$@" 2>&1); }
out="$(hook --hook-json gemini:SessionStart)"
printf '%s' "$out" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")).hookSpecificOutput;process.exit(j.hookEventName==="SessionStart"&&/^No task/.test(j.additionalContext)?0:1)' \
  && ok "gemini 的 SessionStart：输出 hookSpecificOutput.additionalContext" || fail "$out"
[ -z "$(hook --if-compacted --hook-json gemini:BeforeAgent)" ] && ok "没压缩过：BeforeAgent 什么都不输出" || fail "没压缩也注入了"
[ -z "$(hook --mark-compacted)" ] && ok "PreCompress：只打标记，不输出" || fail "PreCompress 有输出"
out="$(hook --if-compacted --hook-json gemini:BeforeAgent)"
printf '%s' "$out" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")).hookSpecificOutput;process.exit(j.hookEventName==="BeforeAgent"&&/^No task/.test(j.additionalContext)?0:1)' \
  && ok "压缩后的下一轮：BeforeAgent 注入一次" || fail "$out"
[ -z "$(hook --if-compacted --hook-json gemini:BeforeAgent)" ] && ok "再下一轮：不再注入" || fail "注入了不止一次"

# 用户级钩子在没有账本的目录里触发：什么都不输出、退出 0
N="$TMP/none"; mkdir -p "$N"
out="$(cd "$N" && printf '%s' "$P" | todopi prime --hook --mark-compacted 2>&1; cd "$N" && printf '%s' "$P" | todopi prime --hook --if-compacted --hook-json gemini:BeforeAgent 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "没有账本：标记与注入都静默退出 0" || fail "rc=${rc}：$out"

hook --mark-compacted >/dev/null
ls "$W"/.git/todopi/leases/sessions/*.compacted >/dev/null 2>&1 && [ -z "$(find "$W/.todopi" -name '*.compacted' -o -name sessions)" ] \
  && ok "压缩标记在 .git/todopi/ 的运行时目录里，不进 .todopi/" || fail "标记位置不对"

[ "$FAILED" -eq 0 ] && { echo "f17-setup-cursor-gemini: pass"; exit 0; } || { echo "f17-setup-cursor-gemini: fail"; exit 1; }
