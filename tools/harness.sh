#!/usr/bin/env bash
# tools/harness.sh — todopi coding-agent harness
#
# 契约：docs/harness/verification.md（三层模型与状态词汇）
# 权威地图：docs/harness/index.md
#
# 兼容 macOS 自带的 bash 3.2：不使用 declare -A、mapfile、${var,,}。
# 见 DECISIONS.md D001。

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 2

RESULTS_DIR=".harness-results"
LAST_OVERALL=""   # 最近一次 check/test/e2e 的 overall，供 ci 汇总读取
FEATURES="feature_list.json"
ARCH_RULES=".harness/arch-rules.json"
PROGRESS="PROGRESS.md"

if [ -t 1 ]; then
  C_RED=$'\033[0;31m'; C_GRN=$'\033[0;32m'; C_YEL=$'\033[1;33m'
  C_CYN=$'\033[0;36m'; C_DIM=$'\033[2m';   C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_YEL=''; C_CYN=''; C_DIM=''; C_BLD=''; C_RST=''
fi

utc_now()  { date -u +%Y-%m-%dT%H:%M:%SZ; }
stamp()    { date -u +%Y%m%dT%H%M%SZ; }
have()     { command -v "$1" >/dev/null 2>&1; }
head_sha() { git rev-parse HEAD 2>/dev/null || echo "unknown"; }
die()      { printf '%s%s%s\n' "$C_RED" "$*" "$C_RST" >&2; exit 2; }

header() { printf '\n%s%s%s\n' "$C_CYN$C_BLD" "$*" "$C_RST"; }

# ── 检查结果累加器 ────────────────────────────────────────────────────────────
CHECKS_TMP=""

checks_init() {
  CHECKS_TMP="$(mktemp "${TMPDIR:-/tmp}/todopi-harness.XXXXXX")" || die "无法创建临时文件"
  : > "$CHECKS_TMP"
}

# emit <name> <status> <summary>
# status ∈ pass | fail | blocked | not_applicable —— 见 docs/harness/verification.md
emit() {
  case "$2" in
    pass|fail|blocked|not_applicable) ;;
    *) die "内部错误：非法状态 '$2'（只允许 pass/fail/blocked/not_applicable）" ;;
  esac
  jq -nc --arg n "$1" --arg s "$2" --arg m "$3" \
    '{name:$n,status:$s,summary:$m}' >> "$CHECKS_TMP"
  local col
  case "$2" in
    pass)           col="$C_GRN" ;;
    fail)           col="$C_RED" ;;
    blocked)        col="$C_YEL" ;;
    not_applicable) col="$C_DIM" ;;
  esac
  printf '  %s%-15s%s %-14s %s\n' "$col" "$2" "$C_RST" "$1" "$3"
}

# overall 规则（见 docs/harness/verification.md）：
#   任一 fail                      -> fail
#   无 fail 但有 blocked           -> blocked
#   至少有一项真的跑过并通过        -> pass
#   全部 not_applicable（什么都没跑）-> not_applicable
# 最后一条是刻意的：一层里一个检查都没执行时报 pass，就是这个 harness 要防的假绿。
checks_overall() {
  if grep -q '"status":"fail"' "$CHECKS_TMP" 2>/dev/null; then
    echo fail
  elif grep -q '"status":"blocked"' "$CHECKS_TMP" 2>/dev/null; then
    echo blocked
  elif grep -q '"status":"pass"' "$CHECKS_TMP" 2>/dev/null; then
    echo pass
  else
    echo not_applicable
  fi
}

checks_json_array() { jq -sc '.' "$CHECKS_TMP"; }

checks_done() { [ -n "$CHECKS_TMP" ] && rm -f "$CHECKS_TMP"; CHECKS_TMP=""; }

# ── Layer 1：静态检查 ─────────────────────────────────────────────────────────

check_docs_links() {
  local missing="" f dir targets t cand
  for f in $(git ls-files '*.md' 2>/dev/null); do
    dir="$(dirname "$f")"
    targets="$(grep -oE '\]\([^)]+\)' "$f" 2>/dev/null \
      | sed -e 's/^](//' -e 's/)$//' -e 's/#.*$//' \
      | grep -vE '^(https?://|mailto:|$)' || true)"
    for t in $targets; do
      case "$t" in
        /*) cand="${t#/}" ;;
        *)  cand="$dir/$t" ;;
      esac
      [ -e "$cand" ] || missing="$missing $f -> $t;"
    done
  done
  if [ -n "$missing" ]; then
    emit docs-links fail "失效的相对链接：$missing"
  else
    emit docs-links pass "所有 Markdown 相对链接指向的文件都存在"
  fi
}

check_spec_version() {
  if [ ! -f spec/todopi-format-v1.md ]; then
    emit spec-version fail "spec/todopi-format-v1.md 不存在"
  elif grep -qE '^Applies to: .*`version: 1`' spec/todopi-format-v1.md; then
    emit spec-version pass "格式规格声明了 version: 1"
  else
    emit spec-version fail "spec/todopi-format-v1.md 顶部缺少 'Applies to: \`version: 1\`' 声明"
  fi
}

check_prd_sync() {
  local en="docs/product/todopi-prd.md" zh="docs/product/todopi-prd.zh-CN.md"
  if [ ! -f "$en" ] || [ ! -f "$zh" ]; then
    emit prd-sync fail "PRD 中英文版本缺失其一（$en / ${zh}）"
    return
  fi
  local dirty_en dirty_zh
  dirty_en="$(git status --porcelain -- "$en" 2>/dev/null)"
  dirty_zh="$(git status --porcelain -- "$zh" 2>/dev/null)"
  if [ -n "$dirty_en" ] && [ -z "$dirty_zh" ]; then
    emit prd-sync fail "英文 PRD 有未同步的改动，中文版未跟进（须在 same commit 内同步）"
  elif [ -z "$dirty_en" ] && [ -n "$dirty_zh" ]; then
    emit prd-sync fail "中文 PRD 单边改动。English-first：先改英文版再同步中文版"
  else
    emit prd-sync pass "PRD 中英文版本同时存在且无单边改动"
  fi
}

check_typecheck() {
  # 绝不自动安装。`bunx tsc` 会联网下载 TypeScript 并写 lockfile——
  # 一个会改动仓库的验证命令，比没有验证更危险。
  if [ ! -d src ]; then
    emit typecheck not_applicable "仓库尚无 src/，无代码可做类型检查"
  elif [ ! -f tsconfig.json ]; then
    emit typecheck blocked "src/ 已存在但缺少 tsconfig.json，无法确定类型检查配置"
  elif [ ! -x node_modules/.bin/tsc ]; then
    emit typecheck blocked "缺少本地 typescript 依赖（harness 不会自动安装）；先跑 ./init.sh 或 bun install"
  else
    local out
    if out="$(node_modules/.bin/tsc --noEmit 2>&1)"; then
      emit typecheck pass "tsc --noEmit 通过"
    else
      emit typecheck fail "tsc --noEmit 失败：$(printf '%s' "$out" | head -5 | tr '\n' ' ')"
    fi
  fi
}

# ── 架构规则 ─────────────────────────────────────────────────────────────────

run_arch_rules() {
  local verbose="${1:-quiet}"
  if [ ! -f "$ARCH_RULES" ]; then
    emit arch-rules blocked "$ARCH_RULES 不存在，架构约束无人执行"
    return
  fi
  local n i id desc applies chk expect what why fix out failed napp
  n="$(jq '.rules | length' "$ARCH_RULES")"
  failed=0; napp=0
  i=0
  while [ "$i" -lt "$n" ]; do
    id="$(jq -r ".rules[$i].id" "$ARCH_RULES")"
    desc="$(jq -r ".rules[$i].description" "$ARCH_RULES")"
    applies="$(jq -r ".rules[$i].applies_when" "$ARCH_RULES")"
    chk="$(jq -r ".rules[$i].check" "$ARCH_RULES")"
    expect="$(jq -r ".rules[$i].expect" "$ARCH_RULES")"
    if ! eval "$applies" >/dev/null 2>&1; then
      napp=$((napp + 1))
      [ "$verbose" = "verbose" ] && printf '  %s%-15s%s %-10s %s\n' "$C_DIM" not_applicable "$C_RST" "$id" "${desc}（前置条件不满足：${applies}）"
      i=$((i + 1)); continue
    fi
    out="$(eval "$chk" 2>&1)"
    if [ "$expect" = "empty" ] && [ -n "$(printf '%s' "$out" | tr -d '[:space:]')" ]; then
      failed=$((failed + 1))
      what="$(jq -r ".rules[$i].what" "$ARCH_RULES")"
      why="$(jq -r ".rules[$i].why" "$ARCH_RULES")"
      fix="$(jq -r ".rules[$i].fix" "$ARCH_RULES")"
      printf '  %s%-15s%s %-10s %s\n' "$C_RED" fail "$C_RST" "$id" "$desc"
      printf '    %sWHAT%s %s\n' "$C_BLD" "$C_RST" "$what"
      printf '    %sWHY %s %s\n' "$C_BLD" "$C_RST" "$why"
      printf '    %sFIX %s %s\n' "$C_BLD" "$C_RST" "$fix"
      printf '    %s%s%s\n' "$C_DIM" "$(printf '%s' "$out" | head -10)" "$C_RST"
    else
      [ "$verbose" = "verbose" ] && printf '  %s%-15s%s %-10s %s\n' "$C_GRN" pass "$C_RST" "$id" "$desc"
    fi
    i=$((i + 1))
  done
  if [ "$failed" -gt 0 ]; then
    emit arch-rules fail "$failed/$n 条架构规则违规（详情见上方 WHAT/WHY/FIX）"
  elif [ "$napp" -eq "$n" ]; then
    emit arch-rules not_applicable "全部 $n 条规则的前置条件都不满足（仓库尚无源码）"
  else
    emit arch-rules pass "$((n - napp))/$n 条规则通过，$napp 条不适用"
  fi
}

# ── 命令：doctor ─────────────────────────────────────────────────────────────

doctor_finding() { # name status summary next_command
  local col
  case "$2" in
    pass) col="$C_GRN" ;;
    warn) col="$C_YEL" ;;
    *)    col="$C_RED" ;;
  esac
  printf '  %s%-6s%s %-14s %s\n' "$col" "$2" "$C_RST" "$1" "$3"
  [ -n "${4:-}" ] && printf '         %s下一步：%s%s\n' "$C_DIM" "$4" "$C_RST"
  [ "$2" = "fail" ] && DOCTOR_FAILED=1
  return 0
}

cmd_doctor() {
  DOCTOR_FAILED=0
  header "doctor —— 只读环境诊断（不安装、不下载、不写任何被跟踪文件）"

  if git rev-parse --git-dir >/dev/null 2>&1; then
    doctor_finding git pass "git $(git --version | awk '{print $3}')，工作区是 git 仓库"
  else
    doctor_finding git fail "当前目录不是 git 仓库" "git init"
  fi

  if have jq; then
    doctor_finding jq pass "$(jq --version)"
  else
    doctor_finding jq fail "缺少 jq，feature 与架构规则相关命令将 blocked" "brew install jq"
  fi

  if have make; then
    doctor_finding make pass "$(make --version | head -1)"
  else
    doctor_finding make fail "缺少 make" "xcode-select --install"
  fi

  if have bun; then
    doctor_finding bun pass "bun $(bun --version)"
  else
    doctor_finding bun warn "缺少 bun：Layer 2/3 将报 blocked（当前尚无代码，不阻塞）" "curl -fsSL https://bun.sh/install | bash"
  fi

  if have node; then
    local nv
    nv="$(node --version | sed 's/^v//' | cut -d. -f1)"
    if [ "$nv" -ge 20 ] 2>/dev/null; then
      doctor_finding node pass "node $(node --version)（要求 >= 20）"
    else
      doctor_finding node warn "node $(node --version) 低于 PRD 要求的 >= 20" "安装 Node 20+（见 .tool-versions）"
    fi
  else
    doctor_finding node warn "缺少 node（PRD 要求 npm 包运行于 Node >= 20）" "安装 Node 20+（见 .tool-versions）"
  fi

  local missing=""
  for f in AGENTS.md CLAUDE.md PROGRESS.md DECISIONS.md feature_list.json \
           "$ARCH_RULES" docs/harness/index.md docs/harness/verification.md \
           docs/harness/scope.md docs/harness/state-migration.md \
           docs/harness/engineering-rules.md Makefile init.sh; do
    [ -e "$f" ] || missing="$missing $f"
  done
  if [ -z "$missing" ]; then
    doctor_finding harness-files pass "harness 文件齐备"
  else
    doctor_finding harness-files fail "缺少：$missing" "参考 docs/harness/index.md 补齐"
  fi

  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    doctor_finding worktree warn "工作区有未提交改动（诊断信息，不是错误）" ""
  else
    doctor_finding worktree pass "工作区干净"
  fi

  if [ -d src ]; then
    doctor_finding source-tree pass "src/ 存在"
  else
    doctor_finding source-tree warn "尚无 src/：implementation has not started。Layer 2/3 会报 not_applicable" "见 PROGRESS.md 的 Next Steps"
  fi

  printf '\n'
  if [ "$DOCTOR_FAILED" -eq 1 ]; then
    printf '%sdoctor: 有 fail 项，先修好再开始工作。%s\n' "$C_RED$C_BLD" "$C_RST"
    return 1
  fi
  printf '%sdoctor: 环境可用。下一步跑 make status，再跑 make check。%s\n' "$C_GRN" "$C_RST"
  return 0
}

# ── 命令：status ─────────────────────────────────────────────────────────────

cmd_status() {
  header "status —— 当前前向状态"
  printf '  HEAD            %s\n' "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  printf '  分支            %s\n' "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  printf '  工作区          %s\n' "$([ -n "$(git status --porcelain 2>/dev/null)" ] && echo '有未提交改动' || echo '干净')"

  if ! have jq; then
    printf '  %sfeature 状态    blocked：缺少 jq（brew install jq）%s\n' "$C_YEL" "$C_RST"
  elif [ ! -f "$FEATURES" ]; then
    printf '  %sfeature 状态    blocked：%s 不存在%s\n' "$C_YEL" "$FEATURES" "$C_RST"
  else
    local total active passing notstarted
    total="$(jq '.features | length' "$FEATURES")"
    active="$(jq '[.features[] | select(.state=="active")] | length' "$FEATURES")"
    passing="$(jq '[.features[] | select(.state=="passing")] | length' "$FEATURES")"
    notstarted="$(jq '[.features[] | select(.state=="not_started")] | length' "$FEATURES")"
    printf '  feature 合计    %s（not_started %s / active %s / passing %s）\n' \
      "$total" "$notstarted" "$active" "$passing"
    printf '  VCR             %s\n' "$(vcr_value)"
    if [ "$active" -gt 0 ]; then
      printf '\n  %s当前 active：%s\n' "$C_BLD" "$C_RST"
      jq -r '.features[] | select(.state=="active") | "    \(.id)  \(.behavior)"' "$FEATURES"
    elif [ "$total" -eq 0 ]; then
      printf '\n  %sfeature_list 为空表——这是有意的，理由见 docs/harness/scope.md。%s\n' "$C_DIM" "$C_RST"
    else
      printf '\n  %s没有 active feature。make activate F=<id> 认领一个。%s\n' "$C_DIM" "$C_RST"
    fi
  fi

  header "PROGRESS.md — Current State"
  if [ -f "$PROGRESS" ]; then
    awk '/^## Current State/{p=1;next} /^## /{p=0} p' "$PROGRESS" | sed '/^[[:space:]]*$/d' | sed 's/^/  /'
  else
    printf '  %s%s 不存在%s\n' "$C_RED" "$PROGRESS" "$C_RST"
  fi

  local last
  last="$(ls -1t "$RESULTS_DIR"/check-*.json 2>/dev/null | head -1)"
  header "最近一次 check"
  if [ -n "$last" ]; then
    printf '  %s  overall=%s  at %s\n' "$last" "$(jq -r .overall "$last")" "$(jq -r .generated_at "$last")"
  else
    printf '  %s尚无记录。跑 make check。%s\n' "$C_DIM" "$C_RST"
  fi
  printf '\n'
}

# ── 命令：check（Layer 1） ────────────────────────────────────────────────────

cmd_check() {
  have jq || die "check 需要 jq。安装：brew install jq"
  checks_init
  header "check — Layer 1（静态）"
  check_docs_links
  check_spec_version
  check_prd_sync
  run_arch_rules quiet
  check_typecheck

  local overall out ts
  overall="$(checks_overall)"
  mkdir -p "$RESULTS_DIR"
  ts="$(stamp)"
  out="$RESULTS_DIR/check-$ts.json"
  jq -n \
    --arg at "$(utc_now)" \
    --arg sha "$(head_sha)" \
    --arg overall "$overall" \
    --argjson checks "$(checks_json_array)" \
    '{generated_at:$at, base_sha:$sha, overall:$overall,
      layers:[{layer:1, name:"static", status:$overall, checks:$checks}]}' > "$out"
  checks_done

  printf '\n  结果已写入 %s\n' "$out"
  LAST_OVERALL="$overall"
  print_overall "$overall" "check"
  [ "$overall" = "pass" ]
}

print_overall() {
  local col
  case "$1" in
    pass)           col="$C_GRN" ;;
    blocked)        col="$C_YEL" ;;
    not_applicable) col="$C_DIM" ;;
    *)              col="$C_RED" ;;
  esac
  printf '%s%s: overall = %s%s\n' "$col$C_BLD" "$2" "$1" "$C_RST"
}

# ── 命令：test（Layer 2） / e2e（Layer 3） ────────────────────────────────────

cmd_test() {
  header "test — Layer 2（运行时行为）"
  have jq || die "test 需要 jq。安装：brew install jq"
  checks_init
  if [ ! -d tests ] && [ ! -d src ]; then
    emit bun-test not_applicable "尚无 tests/ 与 src/：没有可运行的行为。MUST NOT 因此报 pass"
  elif ! have bun; then
    emit bun-test blocked "测试本该运行，但环境缺少 bun（curl -fsSL https://bun.sh/install | bash）"
  else
    if bun test; then
      emit bun-test pass "bun test 通过"
    else
      emit bun-test fail "bun test 失败，输出见上"
    fi
  fi
  local overall; overall="$(checks_overall)"; checks_done
  LAST_OVERALL="$overall"
  print_overall "$overall" "test"
  case "$overall" in pass|not_applicable) return 0 ;; *) return 1 ;; esac
}

cmd_e2e() {
  header "e2e — Layer 3（系统确认）"
  have jq || die "e2e 需要 jq。安装：brew install jq"
  checks_init
  if [ ! -d tests/e2e ]; then
    emit cli-e2e not_applicable "尚无 tests/e2e：没有可执行的 CLI 可做端到端验证"
  elif ! have bun; then
    emit cli-e2e blocked "端到端本该运行，但环境缺少 bun"
  else
    if bun test tests/e2e; then
      emit cli-e2e pass "端到端测试通过"
    else
      emit cli-e2e fail "端到端测试失败，输出见上"
    fi
  fi
  local overall; overall="$(checks_overall)"; checks_done
  LAST_OVERALL="$overall"
  print_overall "$overall" "e2e"
  case "$overall" in pass|not_applicable) return 0 ;; *) return 1 ;; esac
}

# ── 命令：check-arch ─────────────────────────────────────────────────────────

cmd_check_arch() {
  have jq || die "check-arch 需要 jq。安装：brew install jq"
  checks_init
  header "check-arch — 架构约束（.harness/arch-rules.json）"
  run_arch_rules verbose
  local overall; overall="$(checks_overall)"; checks_done
  print_overall "$overall" "check-arch"
  case "$overall" in pass|not_applicable) return 0 ;; *) return 1 ;; esac
}

# ── feature 状态机 ───────────────────────────────────────────────────────────

features_guard() {
  have jq || die "该命令需要 jq。安装：brew install jq"
  [ -f "$FEATURES" ] || die "$FEATURES 不存在"
}

feature_field() { jq -r --arg id "$1" ".features[] | select(.id==\$id) | .$2 // \"\"" "$FEATURES"; }

feature_exists() { [ -n "$(jq -r --arg id "$1" '.features[] | select(.id==$id) | .id' "$FEATURES")" ]; }

features_write() { # stdin: 新的 JSON
  local tmp; tmp="$(mktemp "${TMPDIR:-/tmp}/todopi-features.XXXXXX")"
  cat > "$tmp" || return 1
  jq -e . "$tmp" >/dev/null || { rm -f "$tmp"; die "生成的 feature_list.json 不是合法 JSON，已放弃写入"; }
  mv "$tmp" "$FEATURES"
}

vcr_value() {
  if ! have jq || [ ! -f "$FEATURES" ]; then echo "n/a"; return; fi
  local a p act
  a="$(jq '[.features[] | select(.state=="active")] | length' "$FEATURES")"
  p="$(jq '[.features[] | select(.state=="passing")] | length' "$FEATURES")"
  act=$((a + p))
  if [ "$act" -eq 0 ]; then echo "n/a（尚无 activated feature）"; return; fi
  printf '%s/%s\n' "$p" "$act"
}

cmd_vcr() {
  features_guard
  local v; v="$(vcr_value)"
  printf 'VCR = %s\n' "$v"
  case "$v" in
    n/a*) printf '%s尚无 activated feature，可以 activate 第一个。%s\n' "$C_DIM" "$C_RST"; return 0 ;;
  esac
  local a; a="$(jq '[.features[] | select(.state=="active")] | length' "$FEATURES")"
  if [ "$a" -gt 0 ]; then
    printf '%s有 %s 个 feature 已 activate 但未 passing。session 结束前若仍如此，在 PROGRESS.md 写明卡在哪一层。%s\n' "$C_YEL" "$a" "$C_RST"
    return 1
  fi
  printf '%s所有 activated feature 都已 passing。%s\n' "$C_GRN" "$C_RST"
}

cmd_activate() {
  features_guard
  local id="${1:-}"
  [ -n "$id" ] || die "用法：make activate F=<id>"
  feature_exists "$id" || die "feature '$id' 不存在于 $FEATURES"

  local st; st="$(feature_field "$id" state)"
  [ "$st" = "not_started" ] || die "feature '$id' 当前是 '$st'，只有 not_started 才能 activate（状态机不允许跳级）"

  local cur; cur="$(jq -r '.features[] | select(.state=="active") | .id' "$FEATURES")"
  [ -z "$cur" ] || die "WIP=1：'$cur' 仍处于 active。先 make verify-feature F=${cur}，或 make release F=$cur"

  local dep unmet=""
  for dep in $(jq -r --arg id "$id" '.features[] | select(.id==$id) | .depends_on // [] | .[]' "$FEATURES"); do
    [ "$(feature_field "$dep" state)" = "passing" ] || unmet="$unmet $dep"
  done
  [ -z "$unmet" ] || die "依赖未 passing：$unmet"

  jq --arg id "$id" '(.features[] | select(.id==$id) | .state) = "active"' "$FEATURES" | features_write
  printf '%s%s 已置为 active。%s\n' "$C_GRN" "$id" "$C_RST"
  printf '记住：one session per feature。完成后跑 make verify-feature F=%s。\n' "$id"
}

cmd_release() {
  features_guard
  local id="${1:-}"
  [ -n "$id" ] || die "用法：make release F=<id>"
  feature_exists "$id" || die "feature '$id' 不存在"
  [ "$(feature_field "$id" state)" = "active" ] || die "只有 active 的 feature 才能 release"
  jq --arg id "$id" '(.features[] | select(.id==$id) | .state) = "not_started"' "$FEATURES" | features_write
  printf '%s%s 已退回 not_started。请在 PROGRESS.md 的 Blockers 写明原因。%s\n' "$C_YEL" "$id" "$C_RST"
}

cmd_verify_feature() {
  features_guard
  local id="${1:-}"
  [ -n "$id" ] || die "用法：make verify-feature F=<id>"
  feature_exists "$id" || die "feature '$id' 不存在"

  local st; st="$(feature_field "$id" state)"
  [ "$st" != "passing" ] || { printf '%s%s 已经是 passing（终态）。行为要改就新开一个 feature。%s\n' "$C_YEL" "$id" "$C_RST"; return 0; }
  [ "$st" = "active" ] || die "feature '$id' 当前是 '$st'。先 make activate F=$id —— 状态机不允许跳级"

  header "verify-feature $id"
  local n i label cmd repair
  n="$(jq -r --arg id "$id" '.features[] | select(.id==$id) | .layers // [] | length' "$FEATURES")"
  if [ "$n" -eq 0 ]; then
    die "feature '$id' 没有定义 layers[]。没有可执行的验证，就没有 passing —— 见 docs/harness/scope.md"
  fi

  i=0
  while [ "$i" -lt "$n" ]; do
    label="$(jq -r --arg id "$id" ".features[] | select(.id==\$id) | .layers[$i].label" "$FEATURES")"
    cmd="$(jq -r --arg id "$id" ".features[] | select(.id==\$id) | .layers[$i].cmd" "$FEATURES")"
    repair="$(jq -r --arg id "$id" ".features[] | select(.id==\$id) | .layers[$i].repair" "$FEATURES")"
    printf '\n%s[layer %s/%s] %s%s\n  $ %s\n' "$C_BLD" "$((i + 1))" "$n" "$label" "$C_RST" "$cmd"
    if eval "$cmd"; then
      printf '  %spass%s\n' "$C_GRN" "$C_RST"
    else
      printf '\n  %sfail — layer "%s" 未通过。do not proceed 到下一层。%s\n' "$C_RED$C_BLD" "$label" "$C_RST"
      printf '  %sHOW TO FIX%s %s\n' "$C_BLD" "$C_RST" "$repair"
      printf '\n%s%s 仍为 active。修好后重跑 make verify-feature F=%s。%s\n' "$C_RED" "$id" "$id" "$C_RST"
      return 1
    fi
    i=$((i + 1))
  done

  local ev
  ev="commit $(git rev-parse --short HEAD 2>/dev/null || echo unknown), verified $(utc_now)"
  jq --arg id "$id" --arg ev "$ev" \
    '(.features[] | select(.id==$id) | .state) = "passing"
     | (.features[] | select(.id==$id) | .evidence) = $ev' "$FEATURES" | features_write
  printf '\n%s%s → passing%s\n  evidence: %s\n' "$C_GRN$C_BLD" "$id" "$C_RST" "$ev"
  printf '下一步：make clean-check，然后更新 PROGRESS.md 并提交。\n'
}

# ── 命令：clean-check ────────────────────────────────────────────────────────

cmd_clean_check() {
  have jq || die "clean-check 需要 jq。安装：brew install jq"
  checks_init
  header "clean-check — 清洁态五维（详见 templates/clean-state-checklist.md）"

  # 1. 基线是绿的（在子 shell 里重跑一次 check，结果落盘后再读）
  ( cmd_check ) >/dev/null 2>&1 || true
  local last overall
  last="$(ls -1t "$RESULTS_DIR"/check-*.json 2>/dev/null | head -1)"
  overall="$([ -n "$last" ] && jq -r .overall "$last" || echo unknown)"
  case "$overall" in
    pass)    emit baseline-green pass "make check overall=pass" ;;
    blocked) emit baseline-green blocked "make check overall=blocked —— blocked 不算通过，在 PROGRESS.md 的 Blockers 写清缺什么" ;;
    *)       emit baseline-green fail "make check overall=${overall}，先修基线" ;;
  esac

  # 2. 没有 debug artifact
  # 只扫 TS/JS 源码：console.log 之类的字面量会出现在本脚本和文档里（比如这一行），
  # 把它们算成残留会让这个检查永远红，agent 学到的第一件事就是忽略它。
  local dbg="" d
  for d in src tests tools scripts; do
    [ -d "$d" ] || continue
    if grep -rnE 'console\.(log|debug)|debugger;|\.only\(|\.skip\(' "$d" \
         --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
         2>/dev/null | head -1 | grep -q .; then
      dbg="$dbg $d"
    fi
  done
  if git ls-files -o --exclude-standard 2>/dev/null | grep -qE '\.(orig|rej|tmp)$'; then
    dbg="$dbg 未跟踪的.orig/.rej/.tmp"
  fi
  if [ -n "$dbg" ]; then
    emit no-debug-artifacts fail "发现 debug 残留：$dbg"
  else
    emit no-debug-artifacts pass "未发现 console.log / debugger / .only / .skip / 临时文件残留"
  fi

  # 3. 状态文件已更新
  if [ ! -f "$PROGRESS" ]; then
    emit state-updated fail "$PROGRESS 不存在"
  elif [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    if git status --porcelain -- "$PROGRESS" 2>/dev/null | grep -q .; then
      emit state-updated pass "工作区有改动，且 $PROGRESS 已同步更新"
    else
      emit state-updated fail "工作区有改动但 $PROGRESS 未更新。clock-out 必须刷新 Current State 与 Next Steps"
    fi
  else
    # 工作区干净 = 工作已提交。此时不能要求 "Last commit == HEAD"：
    # 更新 PROGRESS 本身就会产生新 commit，sha 又变了，这个条件永远无法满足。
    # 可满足且有意义的条件是这两个：
    #   1. 最后一个 commit 确实带上了 PROGRESS.md（状态没有掉队）
    #   2. PROGRESS.md 记录的 Last commit 在当前历史里（不是随手写的过期值）
    local rec touched
    rec="$(grep -oE 'Last commit: `[0-9a-f]+`' "$PROGRESS" | head -1 | tr -d '`' | awk '{print $3}')"
    touched="$(git show --name-only --format= HEAD 2>/dev/null | grep -Fx "$PROGRESS" || true)"
    if [ -z "$touched" ]; then
      emit state-updated fail "最后一个 commit 没有包含 ${PROGRESS}。clock-out 必须把状态和代码放进 same commit"
    elif [ -z "$rec" ]; then
      emit state-updated fail "${PROGRESS} 里找不到 Last commit 行"
    elif git merge-base --is-ancestor "$rec" HEAD >/dev/null 2>&1; then
      emit state-updated pass "${PROGRESS} 随 HEAD 一同提交，记录的 Last commit=${rec} 在当前历史中"
    else
      emit state-updated fail "${PROGRESS} 记录的 Last commit=${rec} 不在当前历史中，是过期或错误的值"
    fi
  fi

  # 4. startup 路径可用
  local miss="" t
  for t in doctor status check activate verify-feature clean-check; do
    grep -qE "^$t[[:space:]]*:" Makefile 2>/dev/null || miss="$miss $t"
  done
  if [ -n "$miss" ]; then
    emit startup-path fail "AGENTS.md 引用的 make 目标缺失：$miss"
  else
    emit startup-path pass "clock-in / clock-out 引用的 make 目标都存在"
  fi

  local final; final="$(checks_overall)"; checks_done
  printf '\n%s第 5 维「diff 是聚焦的」需要人工判断：%s跑 git diff，确认每个文件都能回答“它为什么必须为这个 feature 而改”。\n' "$C_BLD" "$C_RST"
  print_overall "$final" "clean-check"
  [ "$final" = "pass" ]
}

# ── 命令：ci ─────────────────────────────────────────────────────────────────

cmd_ci() {
  have jq || die "ci 需要 jq"
  mkdir -p "$RESULTS_DIR"
  local rc_check=0 rc_test=0 rc_e2e=0 l1 l2 l3
  cmd_check   || rc_check=1 ; l1="$LAST_OVERALL"
  cmd_test    || rc_test=1  ; l2="$LAST_OVERALL"
  cmd_e2e     || rc_e2e=1   ; l3="$LAST_OVERALL"

  {
    echo "## todopi harness — CI scope"
    echo
    echo "| 层 | overall |"
    echo "|---|---|"
    echo "| Layer 1 静态 | \`$l1\` |"
    echo "| Layer 2 运行时 | \`$l2\` |"
    echo "| Layer 3 系统 | \`$l3\` |"
    echo
    echo "表中是各层真实的 overall 状态词，不做模糊表述。\`not_applicable\` 表示这一层"
    echo "一个检查都没执行，它不等于通过；\`blocked\` 表示本该执行但环境不具备。"
    echo
    echo "CI 只跑不依赖真机与交互的层。CLI 交互与人工判断的 diff 聚焦度在 CI 记为"
    echo "\`not_run\`——\`not_run\` 不满足任何 Gate，也不等于通过。"
    echo "状态词汇定义见 \`docs/harness/verification.md\`。"
  } > "$RESULTS_DIR/ci-summary.md"

  cat "$RESULTS_DIR/ci-summary.md"
  [ "$rc_check" -eq 0 ] && [ "$rc_test" -eq 0 ] && [ "$rc_e2e" -eq 0 ]
}

# ── 分发 ─────────────────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
用法：tools/harness.sh <command> [args]

  doctor                  只读环境诊断
  status                  当前前向状态（feature / VCR / PROGRESS / 最近 check）
  check                   Layer 1 静态验证，结果写入 .harness-results/
  test                    Layer 2 运行时验证
  e2e                     Layer 3 系统验证
  check-arch              执行 .harness/arch-rules.json 的架构约束
  vcr                     Verified Completion Ratio
  activate <id>           认领 feature（WIP=1）
  release <id>            把 active feature 退回 not_started
  verify-feature <id>     逐层验证并由 harness 写入 passing + evidence
  clean-check             清洁态五维检查
  ci                      CI 入口：check + test + e2e，产出 ci-summary.md

契约见 docs/harness/verification.md，操作手册见 AGENTS.md。
USAGE
}

main() {
  local cmd="${1:-}"
  [ $# -gt 0 ] && shift
  case "$cmd" in
    doctor)         cmd_doctor "$@" ;;
    status)         cmd_status "$@" ;;
    check)          cmd_check "$@" ;;
    test)           cmd_test "$@" ;;
    e2e)            cmd_e2e "$@" ;;
    check-arch)     cmd_check_arch "$@" ;;
    vcr)            cmd_vcr "$@" ;;
    activate)       cmd_activate "$@" ;;
    release)        cmd_release "$@" ;;
    verify-feature) cmd_verify_feature "$@" ;;
    clean-check)    cmd_clean_check "$@" ;;
    ci)             cmd_ci "$@" ;;
    -h|--help|help|"") usage ;;
    *) printf '未知命令：%s\n\n' "$cmd" >&2; usage >&2; exit 2 ;;
  esac
}

main "$@"
