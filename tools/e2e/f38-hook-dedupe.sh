#!/usr/bin/env bash
# tools/e2e/f38-hook-dedupe.sh —— F38 的 Layer 3：setup 的钩子与市场包同时装了时，会话开始只注入一次 prime。
# 真的并发起五个 `todopi prime --hook`（同一个会话 id，照 agent 钩子那样从 stdin 给 JSON）：恰好一个有输出。
# 别的会话照常；没有会话 id 时每次都印（不去重，免得同一 actor 并行的 agent 互相吞掉 prime）。

set -u
unset CLAUDECODE CODEX_THREAD_ID GEMINI_CLI OPENCODE PI_SESSION_ID CURSOR_AGENT TODOPI_AGENT TODOPI_ACTOR
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cli() { if [ -n "${TODOPI_E2E_BIN:-}" ]; then "$TODOPI_E2E_BIN" "$@"; else node "$ROOT/src/cli.ts" "$@"; fi; }

W="$TMP/w"
mkdir -p "$W"
git -C "$W" init -q
git -C "$W" config user.name tester
cli -C "$W" init >/dev/null 2>&1
A="$(cli -C "$W" --agent claude-code add "held task" | head -1 | cut -d' ' -f1)"
cli -C "$W" --agent claude-code claim "$A" >/dev/null 2>&1

hook() { # hook <out-file> <payload>
  printf '%s' "$2" | (cd "$W" && cli --agent claude-code prime --hook) > "$1" 2>"$1.err"
}

# 五个并发的钩子，同一会话
for k in 1 2 3 4 5; do hook "$TMP/s1-$k.out" "{\"session_id\":\"s1\",\"cwd\":\"$W\"}" & done
wait
n=0; for k in 1 2 3 4 5; do [ -s "$TMP/s1-$k.out" ] && n=$((n + 1)); done
[ "$n" -eq 1 ] && ok "五个并发的钩子（同一会话）：恰好一个注入" || fail "注入了 $n 次；stderr：$(cat "$TMP"/s1-*.out.err | head -5)"
one="$(cat "$TMP"/s1-*.out)"
printf '%s' "$one" | grep -q "held task" && ok "注入的是完整的 prime" || fail "输出：$one"

# 同一会话、不同的事件来源（startup 之后很快 /compact）：两次都该注入（F38 评审）
hook "$TMP/c1.out" "{\"session_id\":\"c\",\"source\":\"startup\",\"cwd\":\"$W\"}"
hook "$TMP/c2.out" "{\"session_id\":\"c\",\"source\":\"compact\",\"cwd\":\"$W\"}"
[ -s "$TMP/c1.out" ] && [ -s "$TMP/c2.out" ] && ok "同一会话 startup 之后马上 compact：两次都注入" || fail "compact 被当成重复吞掉了"

# 不同的 agent、同样的会话 id：互不影响
printf '%s' "{\"session_id\":\"x\",\"cwd\":\"$W\"}" | (cd "$W" && cli --agent claude-code prime --hook) > "$TMP/x1.out" 2>/dev/null
printf '%s' "{\"session_id\":\"x\",\"cwd\":\"$W\"}" | (cd "$W" && cli --agent codex prime --hook) > "$TMP/x2.out" 2>/dev/null
[ -s "$TMP/x1.out" ] && [ -s "$TMP/x2.out" ] && ok "不同 agent 用了同样的会话 id：各自注入" || fail "跨 agent 互相吞掉了"

# 被挡下的那一份不写 prime 记录：之后改了 verify，handoff 照样看得见（F38 评审）
hook "$TMP/v1.out" "{\"session_id\":\"v\",\"cwd\":\"$W\"}"
cli -C "$W" --agent claude-code edit "$A" --verify "echo changed" >/dev/null 2>&1
hook "$TMP/v2.out" "{\"session_id\":\"v\",\"cwd\":\"$W\"}"
changed="$(cli -C "$W" --agent claude-code --json handoff --check --session v | jq -r '[.verifyChanged // [] | .[].id] | join(",")')"
[ -s "$TMP/v1.out" ] && [ ! -s "$TMP/v2.out" ] && [ "$changed" = "$A" ] && ok "被挡下的钩子不挪动 handoff 的 verify 基准" \
  || fail "v1=$(wc -c < "$TMP/v1.out") v2=$(wc -c < "$TMP/v2.out") verifyChanged=$changed"

# pi 与 OpenCode 的真实调用形状（它们的钩子载荷里没有 source）：会话开始之后马上压缩，两次都要注入；同一事件重复才挡（F38 评审二轮）
pic() { (cd "$W" && cli --agent pi prime --hook --session p1 --hook-event "$1" < /dev/null) > "$2" 2>/dev/null; }
pic session_start "$TMP/p1.out"; pic session_start "$TMP/p2.out"; pic session_compact "$TMP/p3.out"
[ -s "$TMP/p1.out" ] && [ ! -s "$TMP/p2.out" ] && [ -s "$TMP/p3.out" ] && ok "pi：session_start 重复被挡，紧接的 session_compact 照常注入" \
  || fail "pi：$(wc -c < "$TMP/p1.out") / $(wc -c < "$TMP/p2.out") / $(wc -c < "$TMP/p3.out")"
occ() { printf '%s' "{\"sessionID\":\"o1\",\"hook_event_name\":\"$1\"}" | (cd "$W" && cli --agent opencode prime --hook) > "$2" 2>/dev/null; }
occ session.created "$TMP/o1.out"; occ session.compacted "$TMP/o2.out"
[ -s "$TMP/o1.out" ] && [ -s "$TMP/o2.out" ] && ok "OpenCode：session.created 之后马上 session.compacted，两次都注入" || fail "OpenCode 压缩后的 prime 被吞了"

# 别的会话照常
hook "$TMP/s2.out" "{\"session_id\":\"s2\",\"cwd\":\"$W\"}"
[ -s "$TMP/s2.out" ] && ok "别的会话照常注入" || fail "s2 没有输出"

# 没有会话 id：不去重
hook "$TMP/n1.out" "{\"cwd\":\"$W\"}"; hook "$TMP/n2.out" "{\"cwd\":\"$W\"}"
[ -s "$TMP/n1.out" ] && [ -s "$TMP/n2.out" ] && ok "没有会话 id：每次都注入" || fail "没有会话 id 时被去重了"

# 手动跑的 prime（不是钩子）从不去重
out="$(cli -C "$W" --agent claude-code prime --session s1)"
printf '%s' "$out" | grep -q "held task" && ok "手动 prime（非钩子）照常输出" || fail "$out"

exit "$FAILED"
