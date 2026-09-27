#!/usr/bin/env bash
# tools/e2e/f20-import-beads.sh —— F20 的 Layer 3。
# 映射由 commands/ 的用例覆盖；这里验证 CLI 接通：默认路径 .beads/issues.jsonl、给路径、--json、doctor 通过、
# 重复导入幂等、两个进程同时导入不会建出两份、参数错误。真实的 Beads 导出（v0.47.1，2404 行）实测记在 D041。

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
todopi() { if [ -n "${TODOPI_E2E_BIN:-}" ]; then "$TODOPI_E2E_BIN" "$@"; else node "$ROOT/src/cli.ts" "$@"; fi; }

W="$TMP/w"
mkdir -p "$W/.beads"
git -C "$W" init -q
todopi -C "$W" init >/dev/null 2>&1

# 300 条：每 10 条一个 epic 做父级，每条 blocks 前一条；另有 5 条 tombstone、5 条 ephemeral
node -e '
const out = [];
for (let i = 0; i < 300; i++) {
  const id = `bd-${i}`, deps = [];
  if (i % 10 !== 0) deps.push({ issue_id: id, depends_on_id: `bd-${i - (i % 10)}`, type: "parent-child" });
  if (i % 10 > 1) deps.push({ issue_id: id, depends_on_id: `bd-${i - 1}`, type: "blocks" });
  out.push({ id, title: `Issue ${i}`, status: i % 3 === 0 ? "closed" : "open", priority: i % 5, issue_type: i % 10 === 0 ? "epic" : "task",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", ...(i % 3 === 0 ? { close_reason: i % 9 === 0 ? "Stale, not needed" : "Done" } : {}),
    ...(deps.length ? { dependencies: deps } : {}) });
}
for (let i = 0; i < 5; i++) out.push({ id: `bd-t${i}`, title: "gone", status: "tombstone", priority: 2 });
for (let i = 0; i < 5; i++) out.push({ id: `bd-e${i}`, title: "wisp", status: "closed", priority: 2, ephemeral: true });
process.stdout.write(out.map((o) => JSON.stringify(o)).join("\n") + "\n");
' > "$W/.beads/issues.jsonl"

out="$(cd "$W" && todopi import beads 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -q "^Imported 300 Beads issues from .beads/issues.jsonl (200 open, 100 closed).$" \
  && printf '%s\n' "$out" | grep -q "5 deleted (tombstone), 5 ephemeral" && ok "默认读 .beads/issues.jsonl：300 条，跳过 tombstone 与 ephemeral" || fail "rc=${rc}：$out"
todopi -C "$W" doctor >/dev/null 2>&1 && ok "doctor 通过" || fail "$(todopi -C "$W" doctor 2>&1 | tail -5)"
[ "$(todopi -C "$W" ls --all | wc -l | tr -d ' ')" = "300" ] && ok "账本里恰好 300 个" || fail "$(todopi -C "$W" ls --all | wc -l)"
[ "$(todopi -C "$W" ls --all | grep -c '\[unverified\]')" = "0" ] && ok "迁移来的已关闭任务不显示为未验证" || fail "有未验证标记"

out="$(cd "$W" && todopi --json import beads 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s' "$out" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));process.exit(r.created.length===0&&r.skipped.already_imported===300?0:1)' \
  && ok "重复导入：--json 报 0 新建、300 已导入" || fail "rc=${rc}：$(printf '%s' "$out" | head -c 300)"

# 给路径；两个进程同时导入同一份：锁保证只建一份
W2="$TMP/w2"
mkdir -p "$W2"
git -C "$W2" init -q
todopi -C "$W2" init >/dev/null 2>&1
cp "$W/.beads/issues.jsonl" "$TMP/export.jsonl"
(cd "$W2" && todopi import beads "$TMP/export.jsonl" >/dev/null 2>&1) &
a=$!
(cd "$W2" && todopi import beads "$TMP/export.jsonl" >/dev/null 2>&1) &
b=$!
wait "$a"; ra=$?
wait "$b"; rb=$?
n="$(todopi -C "$W2" ls --all | wc -l | tr -d ' ')"
[ "$n" = "300" ] && ok "给路径导入；两个进程同时导入只建一份（rc ${ra} / ${rb}）" || fail "账本里有 ${n} 个（应为 300），rc ${ra} / ${rb}"

W3="$TMP/w3"
mkdir -p "$W3"
git -C "$W3" init -q
todopi -C "$W3" init >/dev/null 2>&1
out="$(cd "$W3" && todopi import beads 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q ".beads/issues.jsonl" && ok "没有 .beads/issues.jsonl：退出 1 并点名路径" || fail "rc=${rc}：$out"
out="$(cd "$W3" && todopi import plan.md extra 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "import <plan.md> 多给一个参数：退出 1" || fail "rc=${rc}：$out"

[ "$FAILED" -eq 0 ] && { echo "f20-import-beads: pass"; exit 0; } || { echo "f20-import-beads: fail"; exit 1; }
