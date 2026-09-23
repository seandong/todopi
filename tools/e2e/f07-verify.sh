#!/usr/bin/env bash
# tools/e2e/f07-verify.sh —— F07 的 Layer 3。
# verify 的判定逻辑由 domain/ 与 commands/ 的用例覆盖；这里验证端到端真的接通了：
# 退出码、输出的三个去向、信任的位置、超时终止整棵树、执行前原样打印命令。

set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 绝不碰真实的 ~/.config/todopi/trust
export TODOPI_CONFIG_DIR="$TMP/config"
unset CI 2>/dev/null || true

cli() { node "$ROOT/src/cli.ts" "$@"; }
jfield() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s)[process.argv[1]])))' "$1"; }

W="$TMP/w"
mkdir -p "$W"
git -C "$W" init -q
git -C "$W" config user.name tester
git -C "$W" config user.email t@e
git -C "$W" commit -q --allow-empty -m init
cli -C "$W" init >/dev/null 2>&1
TASKS="$W/.todopi/tasks"
CACHE="$W/.todopi/.cache/verify"

# 1. 未信任的仓库拒绝执行，并说清怎么批准（FR-D4）
A=$(cli -C "$W" --json add "passing" --verify "echo VERIFY-RAN" | jfield id)
out="$(cli -C "$W" done "$A" 2>&1)"; code=$?
[ "$code" -eq 2 ] && ok "未信任的仓库退出 2" || fail "应退出 2，实际 $code"
case "$out" in *"--yes"*) ok "说清了怎么批准" ;; *) fail "没说怎么批准：$out" ;; esac
case "$out" in *"echo VERIFY-RAN"*) ok "拒绝时也原样打印了那条命令" ;; *) fail "没打印命令" ;; esac
[ -f "$TASKS/$A.md" ] && grep -q '^status: "open"$' "$TASKS/$A.md" && ok "被拒绝时任务没变" || fail "任务被改了"

# 2. --yes 之后通过，Log 记 verify=pass 且**不记录输出**（FR-D4a）
cli -C "$W" done "$A" --yes >/dev/null 2>&1
[ $? -eq 0 ] && ok "--yes 之后 verify 通过并关闭" || fail "应当成功"
line="$(grep '^- 2' "$TASKS/$A.md" | tail -1)"
case "$line" in *"verify=pass"*) ok "Log 记 verify=pass" ;; *) fail "缺 verify=pass：$line" ;; esac
case "$line" in *"commit="*) ok "Log 带 commit" ;; *) fail "缺 commit" ;; esac
# 正文里不该有输出；命令本身在 frontmatter 里，所以只看 ## Log 之后
body="$(sed -n '/^## Log/,$p' "$TASKS/$A.md")"
case "$body" in *VERIFY-RAN*) fail "通过时不该把输出记进 Log" ;; *) ok "通过时不记录输出" ;; esac

# 3. 完整输出落 .todopi/.cache/verify/，且 git 看不见（FR-D4a + spec §2）
n=$(ls "$CACHE" 2>/dev/null | wc -l | tr -d ' ')
[ "$n" -ge 1 ] && ok "完整输出落在 .todopi/.cache/verify/" || fail "没有日志文件"
grep -q 'VERIFY-RAN' "$CACHE"/*.log && ok "日志里有完整输出" || fail "日志内容不对"
grep -q 'echo VERIFY-RAN' "$CACHE"/*.log && ok "日志里有原样的命令" || fail "日志里没有命令"
if git -C "$W" status --porcelain | grep -q '\.cache'; then
  fail "完整输出被 git 看见了（应当被 .todopi/.gitignore 挡住）"
else
  ok "完整输出不进 git"
fi

# 4. 信任记录**绝不在仓库里**（spec §8）
found=$(find "$W" -iname '*trust*' | wc -l | tr -d ' ')
[ "$found" -eq 0 ] && ok "仓库里找不到任何 trust 文件" || fail "仓库里有 $found 个 trust 文件"
[ -f "$TODOPI_CONFIG_DIR/todopi/trust" ] && ok "信任记在用户级配置里" || fail "信任文件不在配置目录"

# 5. verify 失败 → 退出 2，Log 一行都没长，报告带命令/退出码/尾部/日志路径
B=$(cli -C "$W" --json add "failing" --verify "echo BOOM-OUTPUT >&2; exit 3" | jfield id)
before=$(grep -c '^- 2' "$TASKS/$B.md")
out="$(cli -C "$W" done "$B" 2>&1)"; code=$?
[ "$code" -eq 2 ] && ok "verify 失败退出 2" || fail "应退出 2，实际 $code"
[ "$(grep -c '^- 2' "$TASKS/$B.md")" -eq "$before" ] && ok "被拒绝时 Log 一行都没长" || fail "Log 变长了"
case "$out" in *"exit 3"*) ok "报告带原样的命令" ;; *) fail "报告里没有命令" ;; esac
case "$out" in *"exited 3"*) ok "报告带退出码" ;; *) fail "报告里没有退出码" ;; esac
case "$out" in *BOOM-OUTPUT*) ok "报告带输出尾部" ;; *) fail "报告里没有输出" ;; esac
case "$out" in *".cache/verify/"*) ok "报告给出完整日志的路径" ;; *) fail "没给日志路径" ;; esac

# 6. 报告给出的日志路径真的存在且可读
logpath="$(printf '%s' "$out" | grep -oE '[^ ]*\.cache/verify/[^ ]*\.log' | head -1)"
if [ -n "$logpath" ] && [ -f "$W/$logpath" -o -f "$logpath" ]; then
  ok "报告给出的日志路径可读"
else
  fail "报告给出的日志路径打不开：$logpath"
fi

# 7. --force 照跑 verify，失败也关闭，Log 记 verify=fail 与输出尾部
cli -C "$W" done "$B" --force --reason "shipping anyway" >/dev/null 2>&1
[ $? -eq 0 ] && ok "--force 关闭成功" || fail "--force 应当成功"
line="$(grep '^- 2' "$TASKS/$B.md" | tail -1)"
case "$line" in *"verify=fail"*) ok "Log 记 verify=fail（说明它照跑了）" ;; *) fail "缺 verify=fail：$line" ;; esac
case "$line" in *"forced=true"*) ok "Log 记 forced=true" ;; *) fail "缺 forced=true" ;; esac
grep -q '^  .*BOOM-OUTPUT' "$TASKS/$B.md" && ok "输出尾部按续行缩进两格记进 Log" || fail "尾部没记或没缩进"
cli -C "$W" doctor >/dev/null 2>&1 && ok "带多行 Log 的文件仍通过 doctor" || fail "doctor 不过"
case "$(cli -C "$W" ls --closed 2>/dev/null | grep "$B")" in
  *unverified*) ok "强制关闭的任务标为 unverified" ;;
  *) fail "没标 unverified" ;;
esac

# 8. 没有 verify 字段 → verify=none
C=$(cli -C "$W" --json add "no verify" | jfield id)
cli -C "$W" done "$C" >/dev/null 2>&1
case "$(grep '^- 2' "$TASKS/$C.md" | tail -1)" in
  *"verify=none"*) ok "没有 verify 字段时记 verify=none" ;;
  *) fail "应当是 verify=none" ;;
esac

# 9. **超时终止整个进程组** —— 按 pid 断言孙进程已死（FR-D2）
#    这是本 feature 的核心：实测过默认方式只杀直接子进程，孙进程全部存活。
PIDFILE="$TMP/grandchild.pid"
rm -f "$PIDFILE"
node -e '
const fs=require("node:fs");
const p=process.argv[1];
let s=fs.readFileSync(p,"utf8");
s=s.replace(/^verify_timeout_seconds: .*$/m,"verify_timeout_seconds: 1");
fs.writeFileSync(p,s);
' "$W/.todopi/config.yml"
D=$(cli -C "$W" --json add "spawns grandchild" --verify "bash -c 'echo \$\$ > $PIDFILE; sleep 30' & sleep 30" | jfield id)
cli -C "$W" done "$D" >/dev/null 2>&1
code=$?
[ "$code" -eq 2 ] && ok "超时的 verify 退出 2" || fail "应退出 2，实际 $code"
if [ -f "$PIDFILE" ]; then
  gpid=$(cat "$PIDFILE")
  sleep 1
  if kill -0 "$gpid" 2>/dev/null; then
    fail "**孙进程仍然存活**（pid ${gpid}）—— 只杀了直接子进程"
    kill -9 "$gpid" 2>/dev/null
  else
    ok "超时后孙进程也被终止（pid ${gpid}）"
  fi
else
  fail "孙进程没来得及写下 pid，这一项没验证到"
fi
out="$(cli -C "$W" done "$D" 2>&1)"
case "$out" in *"timed out"*) ok "报告说的是超时，不是「退出 null」" ;; *) fail "报告没说超时" ;; esac

# 10. CI=true 跳过确认
W2="$TMP/w2"; mkdir -p "$W2"; cli -C "$W2" init >/dev/null 2>&1
E=$(cli -C "$W2" --json add "ci" --verify "exit 0" | jfield id)
CI=true cli -C "$W2" done "$E" >/dev/null 2>&1
[ $? -eq 0 ] && ok "CI=true 跳过确认" || fail "CI=true 应当跳过确认"

# 11. 非 TTY 且没给 --yes 时**不挂起**（agent 在管道里跑的正是这种情形）
W3="$TMP/w3"; mkdir -p "$W3"; cli -C "$W3" init >/dev/null 2>&1
F=$(cli -C "$W3" --json add "no tty" --verify "exit 0" | jfield id)
start=$(date +%s)
cli -C "$W3" done "$F" </dev/null >/dev/null 2>&1
code=$?
elapsed=$(( $(date +%s) - start ))
[ "$code" -eq 2 ] && ok "非 TTY 无 --yes 时退出 2" || fail "应退出 2，实际 $code"
[ "$elapsed" -lt 10 ] && ok "没有挂起（${elapsed}s）" || fail "挂起了 ${elapsed}s"

# 12. 执行前原样打印命令，且走 stderr（--json 的 stdout 要保持可解析）
G=$(cli -C "$W" --json add "printed" --verify "echo PRINTED-CMD-MARKER" | jfield id)
err="$(cli -C "$W" done "$G" 2>&1 >/dev/null)"
case "$err" in *"echo PRINTED-CMD-MARKER"*) ok "执行前原样打印命令（stderr）" ;; *) fail "没打印命令：$err" ;; esac

H=$(cli -C "$W" --json add "json clean" --verify "echo x" | jfield id)
if cli -C "$W" --json done "$H" 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{ JSON.parse(s); })'; then
  ok "--json 的 stdout 仍是干净的 JSON"
else
  fail "verify 的打印污染了 --json 的 stdout"
fi

# 13. 输出是英文
I=$(cli -C "$W" --json add "english" --verify "exit 1" | jfield id)
out="$(cli -C "$W" done "$I" 2>&1)"
if printf '%s' "$out" | grep -q '[一-鿿]'; then
  fail "verify 的报告含中文（CLI 的 stdout 是产品表面，MUST 是英文）"
else
  ok "verify 的报告是英文"
fi

# 14. --json 的 actions 里带日志路径，且每条 command 都能跑
cli -C "$W" --json done "$I" 2>/dev/null > "$TMP/j.json"
if node -e '
const r=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));
const v=r.actions.filter(a=>a.for==="verify");
if(v.length===0) throw new Error("没有 verify 的动作");
if(!v.some(a=>a.command&&a.command.includes(".cache/verify/"))) throw new Error("没给日志路径");
for(const a of r.actions) if(a.command&&/[<>]/.test(a.command)) throw new Error("command 含占位符: "+a.command);
' "$TMP/j.json" 2>/dev/null; then
  ok "--json 的 actions 带日志路径且无占位符"
else
  fail "--json 的 actions 不合格"
fi

[ "$FAILED" -eq 0 ] && { echo "f07-verify: pass"; exit 0; } || { echo "f07-verify: fail"; exit 1; }
