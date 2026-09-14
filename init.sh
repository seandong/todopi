#!/usr/bin/env bash
# init.sh — todopi 开发环境的安装与验证入口。
#
# 规则：本脚本只安装工具、只读诊断，MUST NOT 写任何被跟踪文件。
# 它不改仓库状态，可以反复运行。

set -euo pipefail

cd "$(dirname "$0")"

have() { command -v "$1" >/dev/null 2>&1; }
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "todopi 开发环境初始化"
printf '本脚本不安装依赖到仓库，也不写任何被跟踪文件；缺什么会告诉你怎么装。\n'

MISSING=0

need() { # name install_hint required|optional
  if have "$1"; then
    printf '  ok      %-6s %s\n' "$1" "$(command -v "$1")"
  elif [ "$3" = "required" ]; then
    printf '  MISSING %-6s 必需 —— 安装：%s\n' "$1" "$2"
    MISSING=1
  else
    printf '  absent  %-6s 可选 —— 安装：%s\n' "$1" "$2"
  fi
}

say "工具链"
need git  "xcode-select --install"                        required
need make "xcode-select --install"                        required
need jq   "brew install jq"                               required
need bun  "curl -fsSL https://bun.sh/install | bash"      optional
need node "见 .tool-versions（要求 >= 20）"                optional

if [ "$MISSING" -ne 0 ]; then
  printf '\n\033[0;31m必需工具缺失，补齐后重跑 ./init.sh。\033[0m\n'
  exit 1
fi

say "依赖"
if [ -f package.json ]; then
  if have bun; then
    printf '  检测到 package.json，执行 bun install\n'
    bun install
  else
    printf '  检测到 package.json 但缺少 bun，跳过依赖安装。\n'
  fi
else
  printf '  尚无 package.json —— implementation has not started，无依赖可装。\n'
fi

say "环境诊断"
tools/harness.sh doctor

say "下一步"
cat <<'NEXT'
  1. 读 AGENTS.md 与 docs/harness/index.md
  2. make status   —— 看当前前向状态
  3. make check    —— 确认基线是绿的
  4. 读 PROGRESS.md 的 Next Steps，认领恰好一个 feature
NEXT
