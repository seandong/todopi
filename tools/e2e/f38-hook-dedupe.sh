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
  printf '%s' "$2" | (cd "$W" && cli --agent claude-code prime --hook) > "$1" 2>/dev/null
}

# 五个并发的钩子，同一会话
for k in 1 2 3 4 5; do hook "$TMP/s1-$k.out" "{\"session_id\":\"s1\",\"cwd\":\"$W\"}" & done
wait
n=0; for k in 1 2 3 4 5; do [ -s "$TMP/s1-$k.out" ] && n=$((n + 1)); done
[ "$n" -eq 1 ] && ok "五个并发的钩子（同一会话）：恰好一个注入" || fail "注入了 $n 次"
one="$(cat "$TMP"/s1-*.out)"
printf '%s' "$one" | grep -q "held task" && ok "注入的是完整的 prime" || fail "输出：$one"

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
