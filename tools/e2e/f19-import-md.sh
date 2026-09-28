#!/usr/bin/env bash
# tools/e2e/f19-import-md.sh —— F19 的 Layer 3。
# 映射规则由 commands/ 的用例覆盖；这里验证 CLI 接通：导入、--json、重复导入幂等、两个进程同时导入同一份计划
# 不会建出两份（整次导入在一把账本锁里）、勾选的显示为未验证、doctor 通过、读不了的文件退出 1。

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
mkdir -p "$W/docs"
git -C "$W" init -q
todopi -C "$W" init >/dev/null 2>&1
cat > "$W/docs/plan.md" <<'PLAN'
# Login Plan

## Global Constraints

- Node 22

---

### Task 1: Session store

- [x] **Step 1: Write the failing test**
- [x] **Step 2: Make it pass**

### Task 2: Login route

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Make it pass**
PLAN

out="$(cd "$W" && todopi import docs/plan.md 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -q "^ *Imported 7 tasks from docs/plan.md$" && ok "导入 7 个任务" || fail "rc=${rc}：$out"
[ "$(todopi -C "$W" ls --all | wc -l | tr -d ' ')" = "7" ] && ok "账本里恰好 7 个" || fail "$(todopi -C "$W" ls --all)"
[ "$(todopi -C "$W" ls --all | grep -c '\[unverified\]')" = "3" ] && ok "勾选的步骤与全勾的 Task 1 显示为未验证" || fail "$(todopi -C "$W" ls --all)"
todopi -C "$W" doctor >/dev/null 2>&1 && ok "doctor 通过" || fail "$(todopi -C "$W" doctor 2>&1)"

out="$(cd "$W" && todopi --json import docs/plan.md 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s' "$out" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));process.exit(r.created.length===0&&r.existing===7&&r.source==="docs/plan.md"?0:1)' \
  && ok "重复导入：--json 报 0 新建、7 已存在" || fail "rc=${rc}：$out"
[ "$(todopi -C "$W" ls --all | wc -l | tr -d ' ')" = "7" ] && ok "重复导入不产生重复任务" || fail "重复了"

# 两个进程同时导入同一份新计划：锁保证只建一份
printf '## Parallel\n' > "$W/docs/par.md"
for i in $(seq 1 20); do printf -- '- [ ] item %s\n' "$i" >> "$W/docs/par.md"; done
(cd "$W" && todopi import docs/par.md >/dev/null 2>&1) &
a=$!
(cd "$W" && todopi import docs/par.md >/dev/null 2>&1) &
b=$!
wait "$a"; ra=$?
wait "$b"; rb=$?
n="$(todopi -C "$W" ls --all | wc -l | tr -d ' ')"
[ "$n" = "28" ] && ok "两个进程同时导入：只建一份（rc ${ra} / ${rb}）" || fail "账本里有 ${n} 个任务（应为 28），rc ${ra} / ${rb}"

out="$(todopi -C "$W" import "$W/nope.md" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "读不了的文件退出 1" || fail "rc=${rc}：$out"

[ "$FAILED" -eq 0 ] && { echo "f19-import-md: pass"; exit 0; } || { echo "f19-import-md: fail"; exit 1; }
