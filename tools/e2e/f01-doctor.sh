#!/usr/bin/env bash
# tools/e2e/f01-doctor.sh —— F01 的 Layer 3：真的跑 CLI，断言退出码与输出。
#
# 与 Layer 2 的区别：这里不 import 任何模块，只看一个用户会看到的东西——
# 进程的退出码和 stdout。命令真的能 startup 且正确退出，是 AGENTS.md 要求的运行时信号。
# 它能抓到 Layer 2 抓不到的一类错误：模块都对，但 cli.ts 的装配把它们接错了。

set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mk_ledger() {                      # mk_ledger <dir> [version]
  mkdir -p "$1/.todopi/tasks"
  printf 'version: %s\nid_prefix: tp\n' "${2:-1}" > "$1/.todopi/config.yml"
}

write_task() {                     # write_task <dir> <id> [extra-frontmatter-line]
  { printf -- '---\nid: "%s"\ntitle: "T"\nstatus: "open"\n' "$2"
    [ -n "${3:-}" ] && printf '%s\n' "$3"
    printf 'created: "2026-09-14T09:00:00Z"\nupdated: "2026-09-14T09:00:00Z"\n---\n'
  } > "$1/.todopi/tasks/$2.md"
}

cli() { node "$ROOT/src/cli.ts" "$@"; }

# 1. 干净的账本 → 0
mk_ledger "$TMP/clean"; write_task "$TMP/clean" "tp-a1b2c3"
if out="$(cli -C "$TMP/clean" doctor 2>&1)"; then
  ok "干净账本退出 0"
else
  fail "干净账本应退出 0，实际 $?：$out"
fi

# 2. 违反不变量 → 1，且输出点名规则
mk_ledger "$TMP/bad"; write_task "$TMP/bad" "tp-a1b2c3" 'resolution: "done"'
out="$(cli -C "$TMP/bad" doctor 2>&1)"; code=$?
[ "$code" -eq 1 ] && ok "有问题的账本退出 1" || fail "应退出 1，实际 $code"
case "$out" in *invariant-2*) ok "输出点名 invariant-2" ;; *) fail "输出未点名 invariant-2：$out" ;; esac

# 3. 格式版本过高 → 4
mk_ledger "$TMP/future" 2
out="$(cli -C "$TMP/future" doctor 2>&1)"; code=$?
[ "$code" -eq 4 ] && ok "未来版本退出 4" || fail "应退出 4，实际 $code：$out"

# 4. 没有 .todopi/ → 1
mkdir -p "$TMP/none"
out="$(cli -C "$TMP/none" doctor 2>&1)"; code=$?
[ "$code" -eq 1 ] && ok "找不到账本退出 1" || fail "应退出 1，实际 $code"

# 5. --json 输出是合法 JSON
mk_ledger "$TMP/json"; write_task "$TMP/json" "tp-a1b2c3"
if cli -C "$TMP/json" --json doctor | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{JSON.parse(s)})' 2>/dev/null; then
  ok "--json 输出是合法 JSON"
else
  fail "--json 输出不是合法 JSON"
fi

# 6. 语料库里的 invalid 样例真的被拒绝
mk_ledger "$TMP/fx"
cp spec/fixtures/invalid/assignee-when-open.md "$TMP/fx/.todopi/tasks/tp-a1b2c3.md"
out="$(cli -C "$TMP/fx" doctor 2>&1)"; code=$?
[ "$code" -eq 1 ] && ok "语料的 invalid 样例被拒绝" || fail "应退出 1，实际 $code：$out"

# 7. 环被检出并打印出环的路径
mk_ledger "$TMP/cycle"
write_task "$TMP/cycle" "tp-000001" 'parent: "tp-000002"'
write_task "$TMP/cycle" "tp-000002" 'parent: "tp-000001"'
out="$(cli -C "$TMP/cycle" doctor 2>&1)"; code=$?
[ "$code" -eq 1 ] && ok "有环的账本退出 1" || fail "应退出 1，实际 $code"
case "$out" in *"→"*) ok "输出打印出环的路径" ;; *) fail "输出未打印环路径：$out" ;; esac

[ "$FAILED" -eq 0 ] && { echo "f01-doctor: pass"; exit 0; } || { echo "f01-doctor: fail"; exit 1; }
