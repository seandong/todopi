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

# PRD 自 2026-09-16 起只保留中文单本（DECISIONS D006）。这里不再校验双语同步，
# 只校验它存在——它是多处 source: 引用的目标。
check_prd_present() {
  if [ -f docs/product/todopi-prd.md ]; then
    emit prd-present pass "PRD 存在"
  else
    emit prd-present fail "docs/product/todopi-prd.md 不存在，但多条规则以它为 source"
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
  for f in AGENTS.md CLAUDE.md PROGRESS.md DECISIONS.md \
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
  # **查询失败要让 status 非零退出。** 只把错误打印出来不够：自动调用者看的是退出
  # 码，而不是屏幕（评审实测——上一版打印了「跑不动」却仍然退出 0）。
  local status_rc=0
  printf '  HEAD            %s\n' "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  printf '  分支            %s\n' "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  printf '  工作区          %s\n' "$([ -n "$(git status --porcelain 2>/dev/null)" ] && echo '有未提交改动' || echo '干净')"

  if [ ! -d .todopi/tasks ]; then
    printf '  %s账本            .todopi/ 不存在。先跑 todopi init%s\n' "$C_YEL" "$C_RST"
  else
    printf '  账本            %s\n' "$(ls .todopi/tasks/*.md 2>/dev/null | wc -l | tr -d ' ') 个任务"
    # **先取退出码，再管道。** `cmd | sed || fallback` 里的 `||` 判的是 sed 的退出
    # 码，它几乎总是 0——CLI 崩了会显示成一个空的就绪队列，而 status 退出 0
    # （评审用 NODE_OPTIONS=--definitely-invalid 实测）。这和 make test 里那个被
    # tee 吞掉退出码的 bug 是同一个形状，同一个 session 里第二次。
    local ready rc summary src
    ready="$(node src/cli.ts ls --ready 2>&1)"; rc=$?
    printf '\n  就绪队列（todopi ls --ready）：\n'
    if [ "$rc" -ne 0 ]; then
      printf '    %s跑不动（退出码 %s）：%s%s\n' "$C_YEL" "$rc" "$(printf '%s' "$ready" | head -1)" "$C_RST"
      status_rc=1
    else
      printf '%s\n' "$ready" | sed 's/^/    /'
    fi

    # 计数与「在做」交给解析器，不用 grep——规格允许手写无引号的
    # status: in_progress，按字符形状去数漏得掉；而 `ls --mine` 会把别人认领的
    # 任务藏起来，旧 status 是列出全部 active 的（评审实测，迁移损失表第十三条）。
    summary="$(node tools/ledger-summary.mjs 2>&1)"; src=$?
    if [ "$src" -ne 0 ]; then
      printf '\n  %s账本摘要跑不动（退出码 %s）：%s%s\n' "$C_YEL" "$src" "$(printf '%s' "$summary" | head -1)" "$C_RST"
      status_rc=1
    else
      printf '\n%s\n' "$summary"
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
  if [ -n "$last" ] && have jq; then
    printf '  %s  overall=%s  at %s\n' "$last" "$(jq -r .overall "$last")" "$(jq -r .generated_at "$last")"
  elif [ -n "$last" ]; then
    printf '  %s（缺 jq，读不出 overall）\n' "$last"
  else
    printf '  %s尚无记录。跑 make check。%s\n' "$C_DIM" "$C_RST"
  fi
  printf '\n'

  return "$status_rc"
}

cmd_check() {
  have jq || die "check 需要 jq。安装：brew install jq"
  checks_init
  header "check — Layer 1（静态）"
  check_docs_links
  check_spec_version
  check_prd_present
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

  # 语料库自洽校验。这是 src/ 出现之前 Layer 2 唯一的真实内容——它跑真实文件、
  # 真实解析，不是静态检查。语料库号称是「规格的可执行形式」，只有真的被执行，
  # 这个说法才成立。
  if [ ! -d spec/fixtures ]; then
    emit fixtures fail "spec/fixtures/ 不存在，但 ARCH-009 要求它存在"
  elif ! have node; then
    emit fixtures blocked "校验本该运行，但环境缺少 node（见 .tool-versions）"
  elif node tools/check-fixtures.mjs; then
    emit fixtures pass "spec/fixtures 与格式规格自洽"
  else
    emit fixtures fail "spec/fixtures 校验失败，输出见上"
  fi

  # 单元测试。运行器是 node:test 而非 bun test——见 DECISIONS D006 决策 1：
  # 源码只用 Node API，测试运行器同样不该引入 Bun 专属依赖，否则 CI 与本地会分叉。
  if [ ! -d tests ] && [ ! -d src ]; then
    emit unit-test not_applicable "尚无 tests/ 与 src/：没有可运行的行为。MUST NOT 因此报 pass"
  elif ! have node; then
    emit unit-test blocked "测试本该运行，但环境缺少 node（见 .tool-versions）"
  else
    # **NODE_OPTIONS 非空即拒。**
    #
    # 这条先前写成「挡掉 --test-name-pattern / --test-skip-pattern / --test-only」，
    # 评审随即找出第四个：`--test-shard=1/4` 只跑 188/608，三道门全 pass。
    # 枚举「已知的坏东西」永远漏——这一课刚在 .skip 上学过一遍，我又犯了一次。
    #
    # 改成要求「允许什么」：这一趟必须在干净的 NODE_OPTIONS 下跑。全量与否是
    # 「通过」这两个字的前提，不该由一个我维护的黑名单来担保。
    if [ -n "${NODE_OPTIONS:-}" ]; then
      emit test-not-filtered fail "NODE_OPTIONS 非空（${NODE_OPTIONS}）：它可以筛掉任意多用例而运行器照样退出 0。清空它再跑，这一趟才能算数"
    else
      emit test-not-filtered pass "NODE_OPTIONS 为空，这一趟是全量"
    fi

    # 输出仍然直接流出来，同时留一份给下面数 skipped。
    #
    # **退出码取 PIPESTATUS[0]，不是管道的。** 管道的退出码是最后一个命令
    # （`tee`）的，它几乎总是 0——评审用 `exit 42 | tee /dev/null` 复现了：
    # 测试全红也会被记成 pass。加 tee 是为了数 skipped，差点把整层的判据换掉。
    local _tlog _rc
    _tlog="$(mktemp)"
    # **单测超时 120 秒。** node --test 默认不超时，一个同步死循环不会让用例失败，
    # 只会让 make test 永远挂着（F08：去掉 show --tree 的环检测，实测就是这样）。
    # 注意它在父运行器里**按文件**计：一个测试文件整体超过它也算失败（实测，5 秒
    # 时 claim、ls 等文件都红了）。实测全量在 30 秒超时下全过，120 秒留了 4 倍以上
    # 余量，只挡真挂死。
    # 版本：--test-timeout 要 Node 20.11+。它不引入新约束——harness 直接跑 .ts，
    # 靠的是 Node 22.6+ 的类型剥离（.tool-versions 钉 22.22.0），比它严格得多。
    # package.json 的 engines ">=20" 管的是 npm 包的使用者，不是开发环境。
    node --test --test-timeout=120000 2>&1 | tee "$_tlog"
    _rc="${PIPESTATUS[0]}"
    if [ "$_rc" -eq 0 ]; then
      emit unit-test pass "node --test 通过"
    else
      emit unit-test fail "node --test 失败（退出码 ${_rc}），输出见上"
    fi

    # **被跳过的测试，问运行器，不问源码。**
    #
    # 原先在 clean-check 里用 grep 找 `.skip(`，两轮评审找出四种绕法：单引号理由
    # 被误报、`t.skip("")` 和 `test.skip (...)`（点或括号前有空格）被漏掉。根子
    # 是在用字符形状近似一个需要真解析的判断——F04 的 plainKey 栽过同一个跟头，
    # 那次的解法也是「去问真正的解析器」。
    #
    # node:test 自己报的 skipped 数是权威的：一条被停掉的测试必然进这个计数，
    # 无论它写成什么样；而运行时的条件跳过（环境不具备）在正常机器上根本不触发。
    #
    # **但它只在这一趟是全量时才说明问题**——被筛掉的用例不算 skipped，只是没被
    # 注册。所以上面那道 test-not-filtered 是它的前提，不是可有可无的附加。
    #
    # **状态是 fail，不是 blocked。** 早先留 blocked，是因为仓库里有一条为
    # 「`ps` 不可用」准备的条件跳过。那条用例已经删了（见 tests/exec/run.test.ts
    # 顶部的说明），现在**没有任何跳过是合法的**，所以也不必再区分。
    #
    # **这道门挡不住什么，如实写在这里：** 一个文件若先 `process.exit(0)` 再声明
    # 测试，或把 `test(...)` 包在一个不成立的 `if` 里，它注册的测试数就是零——
    # 而一个「真的只有零条测试的文件」长得一模一样。**没有任何运行器信号能区分
    # 这两者**，所以这里不去假装能挡。防线是代码审查：diff 里出现 `process.exit`
    # 或 `if (...) test(` 就是红旗。
    local _skipped
    _skipped="$(sed -n 's/^# skipped \([0-9][0-9]*\)$/\1/p' "$_tlog" | tail -1)"
    rm -f "$_tlog"
    if [ -z "${_skipped:-}" ]; then
      emit no-skipped-tests blocked "从 node --test 的输出里读不到 skipped 计数"
    elif [ "$_skipped" -eq 0 ]; then
      emit no-skipped-tests pass "没有测试被跳过"
    else
      emit no-skipped-tests fail "${_skipped} 条测试被跳过 —— 仓库里不该有任何跳过，理由见上面的输出"
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
  # 每个 feature 一个 tools/e2e/f<NN>-<name>.sh，与任务 verify 字段里的 system
  # layer 命令一一对应。脚本只看用户会看到的东西——进程退出码与 stdout，不 import
  # 任何模块。这让它能抓到 Layer 2 抓不到的一类错误：模块都对，但装配接错了。
  if [ ! -f src/cli.ts ]; then
    emit cli-e2e not_applicable "尚无 src/cli.ts：没有可执行的 CLI 可做端到端验证"
  elif ! ls tools/e2e/*.sh >/dev/null 2>&1; then
    emit cli-e2e not_applicable "尚无 tools/e2e/*.sh：没有端到端脚本"
  else
    local script name any_fail=0
    for script in tools/e2e/*.sh; do
      name="$(basename "$script" .sh)"
      if bash "$script"; then
        emit "e2e:$name" pass "端到端脚本通过"
      else
        emit "e2e:$name" fail "端到端脚本失败，输出见上"
        any_fail=1
      fi
    done
    [ "$any_fail" -eq 0 ] || true
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
  #
  # 判据按目录职责分两档，因为「什么算残留」取决于这段代码是干什么的：
  #   src/ tests/  —— 产品代码与测试。console.log 在这里几乎总是忘了删的调试语句。
  #   tools/ scripts/ —— harness 自己的命令行脚本，它们的职责就是打印报告。
  #                    把正当输出算成残留，会逼着作者用 process.stdout.write 绕开，
  #                    规则就变成了纯仪式。这里只查无歧义的标记。
  # 收窄而非放宽：debugger / .only / 被停掉的测试，在任何地方都是残留。
  #
  # **.skip 分两种。** `test.skip(...)` / `it.skip(...)` 是把一条测试停在那儿——
  # 那是残留。而 `t.skip("原因")` 是运行时的条件跳过：环境不具备时明确说一声，
  # 比让用例因为环境而红要好。**但仓库里现在一条这样的跳过都没有**：唯一那条
  # （量常驻内存要用 ps，ps 在受限沙箱里 EPERM）已经连同用例一起删了，见
  # tests/exec/run.test.ts 顶部。所以下面判的是 fail，不是 blocked。
  # 只认前者，外加不给理由的 `.skip()`。
  #
  # 这里**只认申明点**：`test.skip(` / `it.skip(` / `describe.skip(` / `suite.skip(`，
  # 点和括号前允许空白（评审指出 `test.skip ("x")` 会绕过去）。
  #
  # **不再试图从源码判断一次 `t.skip(...)` 有没有给理由。** 试过两版：先是「括号里
  # 只有空格」（制表符、注释能绕），再是「紧跟必须是引号」（单引号理由被误报，
  # `t.skip("")` 漏掉）。两轮评审四种绕法，说明这是在用字符形状近似一个需要真解析
  # 的判断——F04 的 plainKey 栽过同一个跟头。
  #
  # 那件事交给权威：`make test` 读 node:test 自己报的 skipped 计数（no-skipped-tests）。
  # 一条被停掉的测试必然进那个计数，无论写成什么样。这里留的是一道便宜的早期信号。
  #
  # 2026-09-23 收窄；这是同类误伤的第七次，形状照旧：措辞对，check 比措辞宽。
  local dbg="" d
  for d in src tests; do
    [ -d "$d" ] || continue
    if grep -rnE 'console\.(log|debug)|debugger;|\.only\(|(test|it|describe|suite)[[:space:]]*\.[[:space:]]*skip[[:space:]]*\(' "$d" \
         --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
         2>/dev/null | head -1 | grep -q .; then
      dbg="$dbg $d"
    fi
  done
  for d in tools scripts; do
    [ -d "$d" ] || continue
    if grep -rnE 'debugger;|\.only\(|(test|it|describe|suite)[[:space:]]*\.[[:space:]]*skip[[:space:]]*\(' "$d" \
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
    emit no-debug-artifacts pass "未发现 console.log / debugger / .only / 被停掉的测试 / 临时文件残留"
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
  for t in doctor status check test e2e clean-check; do
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
  status                  当前前向状态（账本 / PROGRESS / 最近 check）
  check                   Layer 1 静态验证，结果写入 .harness-results/
  test                    Layer 2 运行时验证
  e2e                     Layer 3 系统验证
  check-arch              执行 .harness/arch-rules.json 的架构约束
  clean-check             清洁态五维检查
  ci                      CI 入口：check + test + e2e，产出 ci-summary.md

feature 的认领与完成现在走 CLI：todopi ls --ready / claim / done（2026-09-23 自举）。

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
    clean-check)    cmd_clean_check "$@" ;;
    ci)             cmd_ci "$@" ;;
    -h|--help|help|"") usage ;;
    *) printf '未知命令：%s\n\n' "$cmd" >&2; usage >&2; exit 2 ;;
  esac
}

main "$@"
