#!/usr/bin/env bash
# tools/e2e/f24-edit-body.sh —— F24 的 Layer 3：建好之后改验收标准与 Plan（FR-T4）。
# edit 的 --ac-add / --ac-set / --ac-rm / --plan；add / edit 的 --edit 真的打开 ${VISUAL}（经 script(1) 给一个伪终端），
# 编辑器改完读回；没有终端、编辑器失败、标题清空都什么也不写；动已勾选的标准被拒。

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

# 在伪终端里跑一条 todopi 命令（--edit 要求 stdin、stdout 都是终端）。BSD 与 util-linux 的 script 参数不同。
RUNNER="$TMP/run.sh"
if [ -n "${TODOPI_E2E_BIN:-}" ]; then printf '#!/bin/sh\n"%s" "$@"\necho "rc=$?" > "$RC_FILE"\n' "$TODOPI_E2E_BIN"
else printf '#!/bin/sh\nnode "%s/src/cli.ts" "$@"\necho "rc=$?" > "$RC_FILE"\n' "$ROOT"; fi > "$RUNNER"
chmod +x "$RUNNER"
in_pty() {
  RC_FILE="$TMP/rc"; export RC_FILE; rm -f "$RC_FILE"
  if script -V >/dev/null 2>&1; then
    local q=""; for a in "$@"; do q="$q '$(printf '%s' "$a" | sed "s/'/'\\\\''/g")'"; done
    script -qec "$RUNNER$q" /dev/null </dev/null
  else
    script -q /dev/null "$RUNNER" "$@" </dev/null
  fi
  sed 's/^rc=//' "$RC_FILE" 2>/dev/null || echo "none"
}

W="$TMP/w"
mkdir -p "$W"
git -C "$W" init -q
git -C "$W" config user.name tester
cli -C "$W" init >/dev/null 2>&1

# 选项形式：一次里改、删、加，编号都是编辑前的编号
A="$(cli -C "$W" add "options" --ac "one" --ac "two" --ac "three" | head -1 | cut -d' ' -f1)"
cli -C "$W" check "$A" 1 >/dev/null 2>&1
cli -C "$W" edit "$A" --ac-set "2=TWO" --ac-rm 3 --ac-add "four" --plan "step a" >/dev/null 2>&1; rc=$?
full="$(cli -C "$W" show "$A" --full)"
[ "$rc" -eq 0 ] && printf '%s' "$full" | grep -q "\[x\] one" && printf '%s' "$full" | grep -q "\[ \] TWO" \
  && ! printf '%s' "$full" | grep -q "three" && printf '%s' "$full" | grep -q "\[ \] four" && printf '%s' "$full" | grep -q "step a" \
  && printf '%s' "$full" | grep -q "edited fields=acceptance,plan" && ok "--ac-set / --ac-rm / --ac-add / --plan 一次生效，Log 记下" || fail "rc=${rc}：$full"
before="$(cat "$W"/.todopi/tasks/"$A".md)"
out="$(cli -C "$W" edit "$A" --ac-set "1=changed" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "check $A 1 --undo" && [ "$(cat "$W"/.todopi/tasks/"$A".md)" = "$before" ] \
  && ok "改已勾选的标准被拒，指向 check --undo，文件不变" || fail "rc=${rc}：$out"
T2="$(cli -C "$W" add "renumber" --ac "x" --ac "y" | head -1 | cut -d' ' -f1)"
cli -C "$W" check "$T2" 2 >/dev/null 2>&1
out="$(cli -C "$W" edit "$T2" --ac-rm 1 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "would renumber checked criterion 2" && ok "删已勾选项前面的标准被拒（会改掉 check ac=2 的指向）" || fail "rc=${rc}：$out"
out="$(cli -C "$W" edit "$A" --plan p --edit 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "drop --plan" && ok "--edit 与 --plan 同时给：拒绝" || fail "rc=${rc}：$out"
cli -C "$W" doctor >/dev/null 2>&1 && ok "改完 doctor 通过" || fail "doctor：$(cli -C "$W" doctor 2>&1)"

out="$(cli -C "$W" add 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "add needs a title" && ok "add 不给标题又不 --edit：用法错误" || fail "rc=${rc}：$out"

# --edit 没有终端：用法错误，不写
out="$(cli -C "$W" edit "$A" --edit 2>&1 </dev/null)"; rc=$?
[ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "needs a terminal" && [ "$(cat "$W"/.todopi/tasks/"$A".md)" = "$before" ] \
  && ok "--edit 没有终端：说清楚、不写" || fail "rc=${rc}：$out"

if ! command -v script >/dev/null 2>&1; then
  fail "没有 script(1)，无法在伪终端里验证 --edit"
else
  # 编辑器：把一页整个换成 $EDIT_TO 的内容（node 写，避免 sed -i 的平台差异）；同时留一份打开时看到的原文
  ED="$TMP/ed.sh"
  printf '#!/bin/sh\ncp "$1" "$SEEN"\n[ -n "${EDIT_FAIL:-}" ] && exit 3\ncat "$EDIT_TO" > "$1"\n' > "$ED"; chmod +x "$ED"
  export VISUAL="$ED" SEEN="$TMP/seen" EDIT_TO="$TMP/to"

  printf '# From editor\n\n## Description\n\nwritten in vi\n\n## Acceptance Criteria\n\n- [ ] alpha\n- [ ] beta\n\n## Plan\n\n1. do it\n' > "$EDIT_TO"
  rc="$(in_pty -C "$W" add --edit 2>&1 | tail -1)"
  B="$(cli -C "$W" ls --json | jq -r '.[] | select(.title == "From editor") | .id')"
  full="$(cli -C "$W" show "$B" --full 2>&1)"
  [ "$rc" = "0" ] && [ -n "$B" ] && printf '%s' "$full" | grep -q "written in vi" && printf "%s" "$full" | grep -q "\[ \] beta" \
    && printf '%s' "$full" | grep -q "1. do it" && ok "add --edit：在编辑器里写标题、描述、标准、Plan" || fail "rc=${rc}：$full"

  # edit --edit：编辑器看到的是当前内容；改 Plan、加一条标准，勾选的原样
  printf '# options\n\n## Description\n\n## Acceptance Criteria\n\n- [x] one\n- [ ] TWO\n- [ ] four\n- [ ] five\n\n## Plan\n\nstep b\n' > "$EDIT_TO"
  rc="$(in_pty -C "$W" edit "$A" --edit 2>&1 | tail -1)"
  full="$(cli -C "$W" show "$A" --full)"
  grep -q "step a" "$SEEN" && grep -q -- "- \[x\] one" "$SEEN" && ok "edit --edit：编辑器里是任务当前的标准与 Plan" || fail "$(cat "$SEEN")"
  [ "$rc" = "0" ] && printf "%s" "$full" | grep -q "\[ \] five" && printf '%s' "$full" | grep -q "step b" \
    && ! printf '%s' "$full" | grep -q "step a" && ok "edit --edit：改动读回写入" || fail "rc=${rc}：$full"

  before="$(cat "$W"/.todopi/tasks/"$A".md)"
  printf '# options\n\n## Acceptance Criteria\n\n- [ ] one\n' > "$EDIT_TO"
  rc="$(in_pty -C "$W" edit "$A" --edit 2>&1 | tail -1)"
  [ "$rc" != "0" ] && [ "$(cat "$W"/.todopi/tasks/"$A".md)" = "$before" ] && ok "edit --edit：取消勾选被拒，不写" || fail "rc=$rc"
  printf '#   \n\n## Plan\n\nx\n' > "$EDIT_TO"
  rc="$(in_pty -C "$W" edit "$A" --edit 2>&1 | tail -1)"
  [ "$rc" != "0" ] && [ "$(cat "$W"/.todopi/tasks/"$A".md)" = "$before" ] && ok "edit --edit：标题清空当放弃，不写" || fail "rc=$rc"
  n="$(cli -C "$W" ls --json | jq length)"
  rc="$(EDIT_FAIL=1 in_pty -C "$W" add --edit 2>&1 | tail -1)"
  [ "$rc" != "0" ] && [ "$(cli -C "$W" ls --json | jq length)" = "$n" ] && ok "编辑器非零退出：add 不建任务" || fail "rc=$rc"
fi

exit "$FAILED"
