#!/usr/bin/env bash
# tools/e2e/f02-init.sh —— F02 的 Layer 3。
# 只看用户会看到的东西：退出码、文件系统里真的出现了什么、以及 init 之后
# doctor 是否认账——这是「F01 的读」与「F02 的写」第一次互相验证。

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
cli() { if [ -n "${TODOPI_E2E_BIN:-}" ]; then "$TODOPI_E2E_BIN" "$@"; else node "$ROOT/src/cli.ts" "$@"; fi; }

# 1. 空目录里 init → 0，四样东西都在
mkdir -p "$TMP/fresh"
if cli -C "$TMP/fresh" init >/dev/null 2>&1; then ok "init 退出 0"; else fail "init 应退出 0"; fi
for f in .todopi/config.yml .todopi/tasks .todopi/.gitignore AGENTS.md; do
  [ -e "$TMP/fresh/$f" ] && ok "生成 $f" || fail "缺少 $f"
done

# 2. init 之后 doctor 干净 —— 写出来的东西读得回来
if cli -C "$TMP/fresh" doctor >/dev/null 2>&1; then ok "init 后 doctor 退出 0"; else fail "init 后 doctor 应退出 0"; fi

# 3. 幂等：再跑一次，AGENTS.md 里协议段落仍只有一份
cli -C "$TMP/fresh" init >/dev/null 2>&1
n=$(grep -c 'todopi:protocol:begin' "$TMP/fresh/AGENTS.md")
[ "$n" -eq 1 ] && ok "重复 init 后协议段落仍只有一份" || fail "协议段落出现 $n 份"

# 4. 不碰 CLAUDE.md
if [ -e "$TMP/fresh/CLAUDE.md" ]; then fail "init 不应创建 CLAUDE.md"; else ok "未创建 CLAUDE.md"; fi

# 5. 已有的 AGENTS.md 内容被保留
mkdir -p "$TMP/existing"
printf '# 我的手册\n\n不能被动的内容。\n' > "$TMP/existing/AGENTS.md"
cli -C "$TMP/existing" init >/dev/null 2>&1
grep -q '不能被动的内容。' "$TMP/existing/AGENTS.md" && ok "已有内容被保留" || fail "已有内容丢失"
grep -q 'todopi:protocol:begin' "$TMP/existing/AGENTS.md" && ok "协议已追加" || fail "协议未追加"

# 6. 在 git 仓库子目录里跑，账本建在仓库根（spec §1.1）
mkdir -p "$TMP/repo/.git" "$TMP/repo/packages/web"
cli -C "$TMP/repo/packages/web" init >/dev/null 2>&1
[ -d "$TMP/repo/.todopi" ] && ok "账本建在仓库根" || fail "账本未建在仓库根"
if [ -d "$TMP/repo/packages/web/.todopi" ]; then fail "不应在子目录建账本"; else ok "未在子目录建账本"; fi

# 7. 非法 prefix → 1，且无副作用
mkdir -p "$TMP/badprefix"
cli -C "$TMP/badprefix" init --prefix "TP" >/dev/null 2>&1
code=$?
[ "$code" -eq 1 ] && ok "非法 prefix 退出 1" || fail "非法 prefix 应退出 1，实际 $code"
if [ -e "$TMP/badprefix/.todopi" ]; then fail "被拒绝的 init 不应留下目录"; else ok "被拒绝的 init 未留下副作用"; fi

# 8. --json 是合法 JSON
mkdir -p "$TMP/json"
if cli -C "$TMP/json" --json init | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{JSON.parse(s)})' 2>/dev/null; then
  ok "--json 输出是合法 JSON"
else
  fail "--json 输出不是合法 JSON"
fi

# 9. 高版本账本 → 退出 4，且零副作用（spec §9、FR-Q2）
mkdir -p "$TMP/future/.todopi/tasks"
printf 'version: 2\nid_prefix: tp\n' > "$TMP/future/.todopi/config.yml"
cli -C "$TMP/future" init >/dev/null 2>&1
code=$?
[ "$code" -eq 4 ] && ok "高版本账本退出 4" || fail "应退出 4，实际 $code"
if [ -e "$TMP/future/AGENTS.md" ]; then fail "版本闸门必须在任何写入之前"; else ok "高版本账本零副作用"; fi

# 10. 输出是英文 —— CLI 的 stdout 是产品表面（AGENTS.md）
mkdir -p "$TMP/lang"
out="$(cli -C "$TMP/lang" init 2>&1)"
if printf '%s' "$out" | node -e 'process.exit(/[\u4e00-\u9fff]/u.test(require("fs").readFileSync(0, "utf8")) ? 0 : 1)'; then
  fail "init 输出含中文（CLI 的 stdout 是产品表面，MUST 是英文）：$out"
else
  ok "init 输出是英文"
fi
out="$(cli -C "$TMP/lang" init --prefix BAD 2>&1)"
if printf '%s' "$out" | node -e 'process.exit(/[\u4e00-\u9fff]/u.test(require("fs").readFileSync(0, "utf8")) ? 0 : 1)'; then
  fail "错误信息含中文（CLI 的 stdout 是产品表面，MUST 是英文）：$out"
else
  ok "错误信息是英文"
fi

# 11. --quiet 去掉提示但保留结果
out="$(cli -C "$TMP/lang" --quiet init 2>&1)"
case "$out" in
  *"Next:"*)            fail "--quiet 不应打印提示" ;;
  *"Initialized todopi in"*) ok "--quiet 去掉提示、保留结果" ;;
  *)                    fail "--quiet 把结果也吞掉了：$out" ;;
esac

# 12. --json --quiet 仍是合法 JSON
if cli -C "$TMP/lang" --json --quiet init | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{JSON.parse(s)})' 2>/dev/null; then
  ok "--json --quiet 输出是合法 JSON"
else
  fail "--json --quiet 输出不是合法 JSON"
fi

[ "$FAILED" -eq 0 ] && { echo "f02-init: pass"; exit 0; } || { echo "f02-init: fail"; exit 1; }
