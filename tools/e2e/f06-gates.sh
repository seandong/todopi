#!/usr/bin/env bash
# tools/e2e/f06-gates.sh —— F06 的 Layer 3。
# 门禁判定本身由 domain/ 的纯函数覆盖；这里验证端到端真的接通了：
# 退出码、报告内容、Log 的形状、别名、输出语言。

set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cli() { if [ -n "${TODOPI_E2E_BIN:-}" ]; then "$TODOPI_E2E_BIN" "$@"; else node "$ROOT/src/cli.ts" "$@"; fi; }
jfield() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s)[process.argv[1]])))' "$1"; }

W="$TMP/w"
mkdir -p "$W"
git -C "$W" init -q
git -C "$W" config user.name tester
git -C "$W" config user.email t@e
git -C "$W" commit -q --allow-empty -m init
cli -C "$W" init >/dev/null 2>&1
LEASES="$W/.git/todopi/leases"

# 1. 未勾的验收标准 → 退出 2，报告带序号与原文
A=$(cli -C "$W" --json add "has criteria" --ac "first thing" --ac "second thing" | jfield id)
out="$(cli -C "$W" done "$A" 2>&1)"; code=$?
[ "$code" -eq 2 ] && ok "未勾的验收标准退出 2" || fail "应退出 2，实际 $code"
case "$out" in *"1. first thing"*) ok "报告带序号与原文" ;; *) fail "报告里没有带序号的标准：$out" ;; esac
case "$out" in *"2. second thing"*) ok "每一条都列出来了" ;; *) fail "只列了一条" ;; esac
case "$out" in *"--force --reason"*) ok "报告给出强制的出路" ;; *) fail "没给出路" ;; esac
case "$out" in *"todopi done $A"*) ok "报告给出重跑的出路" ;; *) fail "没给重跑的出路" ;; esac

# 2. 被拒绝之后什么都没改（spec §6.1）
before="$(cat "$W/.todopi/tasks/$A.md")"
logs_before=$(grep -c '^- 2' "$W/.todopi/tasks/$A.md")
cli -C "$W" done "$A" >/dev/null 2>&1
[ "$(cat "$W/.todopi/tasks/$A.md")" = "$before" ] && ok "被拒绝的迁移不改任务文件" || fail "文件被改了"
[ "$(grep -c '^- 2' "$W/.todopi/tasks/$A.md")" -eq "$logs_before" ] && ok "Log 一行都没追加" || fail "Log 变长了"

# 3. 未关闭的子任务 → 退出 2，报告带 id / title / status
P=$(cli -C "$W" --json add "parent" | jfield id)
K=$(cli -C "$W" --json add "the child task" --parent "$P" | jfield id)
out="$(cli -C "$W" done "$P" 2>&1)"; code=$?
[ "$code" -eq 2 ] && ok "未关闭的子任务退出 2" || fail "应退出 2，实际 $code"
for want in "$K" "the child task" "open"; do
  case "$out" in *"$want"*) : ;; *) fail "报告里缺少 $want" ;; esac
done
ok "报告带子任务的 id / title / status"

# 4. 别人持有 → 退出 3
cli -C "$W" --as other@host claim "$K" >/dev/null 2>&1
out="$(cli -C "$W" done "$K" 2>&1)"; code=$?
[ "$code" -eq 3 ] && ok "归属冲突退出 3（不是 2）" || fail "应退出 3，实际 $code"
case "$out" in *other@host*) ok "报告点名持有者" ;; *) fail "报告没说是谁持有" ;; esac

# 5. 多道门一起不过 → 全部列出，退出码取最严重
cli -C "$W" --as other@host claim "$A" >/dev/null 2>&1
out="$(cli -C "$W" done "$A" 2>&1)"; code=$?
[ "$code" -eq 3 ] && ok "多道门时退出码取最严重" || fail "应退出 3，实际 $code"
case "$out" in *"first thing"*) : ;; *) fail "多道门时漏了验收标准那一道" ;; esac
case "$out" in *other@host*) ok "多道门一起列出，不是只列第一条" ;; *) fail "漏了归属那一道" ;; esac

# 6. --force --reason 越过门禁
cli -C "$W" done "$A" --force --reason "shipping anyway" >/dev/null 2>&1
[ $? -eq 0 ] && ok "--force --reason 越过门禁" || fail "强制应当成功"
grep -q 'forced=true' "$W/.todopi/tasks/$A.md" && ok "Log 记 forced=true" || fail "没记 forced=true"
grep -q ': shipping anyway$' "$W/.todopi/tasks/$A.md" && ok "Log 记了理由" || fail "没记理由"

# 7. --force 不带 --reason → 退出 1
cli -C "$W" done "$P" --force >/dev/null 2>&1
[ $? -eq 1 ] && ok "--force 不带 --reason 退出 1" || fail "应退出 1"

# 8. 强制完成的任务在 ls 里标 unverified（F04 的跨 feature 契约）
case "$(cli -C "$W" ls --closed 2>/dev/null)" in
  *unverified*) ok "强制完成的任务标为 unverified" ;;
  *) fail "ls --closed 没标 unverified" ;;
esac

# 9. done 的 Log 行带 verify / commit / dirty（spec §5.3.3）
B=$(cli -C "$W" --json add "plain task" | jfield id)
cli -C "$W" done "$B" >/dev/null 2>&1
line="$(grep '^- 2' "$W/.todopi/tasks/$B.md" | tail -1)"
case "$line" in *"verify=none"*) ok "Log 带 verify=none（F07 会填 pass/fail）" ;; *) fail "缺 verify：$line" ;; esac
case "$line" in *"commit="*) ok "Log 带 commit" ;; *) fail "缺 commit：$line" ;; esac
case "$line" in *"dirty="*) ok "Log 带 dirty" ;; *) fail "缺 dirty：$line" ;; esac

# 9b. 不在 git 仓库里时省略 commit / dirty，而不是写 unknown
NG="$TMP/nogit"; mkdir -p "$NG"
cli -C "$NG" init >/dev/null 2>&1
C=$(cli -C "$NG" --json add "no git here" | jfield id)
cli -C "$NG" done "$C" >/dev/null 2>&1
line="$(grep '^- 2' "$NG/.todopi/tasks/$C.md" | tail -1)"
case "$line" in
  *commit=*|*dirty=*) fail "不在 git 仓库里不该写 commit / dirty：$line" ;;
  *) ok "不在 git 仓库里省略 commit / dirty" ;;
esac
case "$line" in *unknown*) fail "写了假的 commit=unknown" ;; *) ok "没有写假的 sha" ;; esac

# 10. close --resolution
D=$(cli -C "$W" --json add "to cancel" | jfield id)
cli -C "$W" close "$D" --resolution wontfix >/dev/null 2>&1
[ $? -eq 0 ] && ok "close --resolution 成功" || fail "close 应当成功"
grep -q '^resolution: "wontfix"$' "$W/.todopi/tasks/$D.md" && ok "resolution 写入" || fail "resolution 没写"
grep -q 'closed resolution=wontfix' "$W/.todopi/tasks/$D.md" && ok "Log 是 closed resolution=…" || fail "Log 形状不对"

cli -C "$W" close "$B" --resolution nonsense >/dev/null 2>&1
[ $? -eq 1 ] && ok "不合法的 resolution 退出 1" || fail "应退出 1"
E=$(cli -C "$W" --json add "needs resolution" | jfield id)
cli -C "$W" close "$E" >/dev/null 2>&1
[ $? -eq 1 ] && ok "close 不给 --resolution 退出 1" || fail "应退出 1"

# 11. reopen 同时清掉 resolution 与 assignee
cli -C "$W" reopen "$D" >/dev/null 2>&1
[ $? -eq 0 ] && ok "reopen 成功" || fail "reopen 应当成功"
grep -q '^status: "open"$' "$W/.todopi/tasks/$D.md" && ok "状态回到 open" || fail "状态没回到 open"
grep -q '^resolution:' "$W/.todopi/tasks/$D.md" && fail "resolution 必须被移除" || ok "resolution 已移除"
grep -q '^assignee:' "$W/.todopi/tasks/$D.md" && fail "assignee 也必须被移除（不变量 3）" || ok "assignee 已移除"
grep -q ' reopened$' "$W/.todopi/tasks/$D.md" && ok "Log 记 reopened" || fail "Log 没记 reopened"
cli -C "$W" doctor >/dev/null 2>&1 && ok "reopen 之后通过 doctor" || fail "doctor 不过"

# 12. reopen 一个未关闭的任务 → 退出 2
cli -C "$W" reopen "$D" >/dev/null 2>&1
[ $? -eq 2 ] && ok "reopen 未关闭的任务退出 2" || fail "应退出 2"

# 13. 别名（FR-Q4）
F=$(cli -C "$W" --json add "via finish" | jfield id)
cli -C "$W" finish "$F" >/dev/null 2>&1
[ $? -eq 0 ] && ok "别名 finish 可用" || fail "finish 不可用"
G=$(cli -C "$W" --json add "via complete" | jfield id)
cli -C "$W" complete "$G" >/dev/null 2>&1
[ $? -eq 0 ] && ok "别名 complete 可用" || fail "complete 不可用"
H=$(cli -C "$W" --json add "via cancel" | jfield id)
cli -C "$W" cancel "$H" -r obsolete >/dev/null 2>&1
[ $? -eq 0 ] && ok "别名 cancel 接受 -r" || fail "cancel -r 不可用"
I=$(cli -C "$W" --json add "alias force" --ac "x" | jfield id)
cli -C "$W" finish "$I" --force --reason "alias keeps every option" >/dev/null 2>&1
[ $? -eq 0 ] && ok "别名接受基础命令的全部选项" || fail "别名缺选项"

# 14. 输出是英文，--json 的拒绝报告可解析
J=$(cli -C "$W" --json add "english check" --ac "x" | jfield id)
out="$(cli -C "$W" done "$J" 2>&1)"
if printf '%s' "$out" | node -e 'process.exit(/[\u4e00-\u9fff]/u.test(require("fs").readFileSync(0, "utf8")) ? 0 : 1)'; then
  fail "门禁报告含中文（CLI 的 stdout 是产品表面，MUST 是英文）"
else
  ok "门禁报告是英文"
fi
if cli -C "$W" --json done "$J" 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const r=JSON.parse(s);
  for(const k of ["id","title","transition","refused","code"]) if(!(k in r)) throw new Error("缺 "+k);
  if(!Array.isArray(r.refused)||r.refused.length===0) throw new Error("refused 应当非空");
})'; then ok "--json 的拒绝报告可解析且字段齐全"; else fail "--json 拒绝报告不合格"; fi

# 15. 带 external 与怪键的任务关闭后原样保留
K2=$(cli -C "$W" --json add "has extensions" | jfield id)
node -e '
const fs=require("node:fs"),p=process.argv[1];
fs.writeFileSync(p, fs.readFileSync(p,"utf8").replace(/^status: "open"$/m,
  "status: \"open\"\nexternal:\n  linear:\n    id: \"ENG-1\"\n\"#meta\": \"keep\"\nx-count: 5"));
' "$W/.todopi/tasks/$K2.md"
cli -C "$W" done "$K2" >/dev/null 2>&1
grep -q 'ENG-1' "$W/.todopi/tasks/$K2.md" && ok "external 原样保留" || fail "external 丢了"
grep -q '"#meta"' "$W/.todopi/tasks/$K2.md" && ok "怪键原样保留" || fail "怪键丢了"
grep -q '^x-count: 5$' "$W/.todopi/tasks/$K2.md" && ok "数字仍是数字" || fail "数字被加了引号"
cli -C "$W" doctor >/dev/null 2>&1 && ok "带扩展字段的任务关闭后通过 doctor" || fail "doctor 不过"


# 16. close 不查验收标准 —— 取消一个半截的任务不必强制（spec §6.1 表格）
L=$(cli -C "$W" --json add "abandon me" --ac "never finished" | jfield id)
cli -C "$W" close "$L" --resolution wontfix >/dev/null 2>&1
[ $? -eq 0 ] && ok "close 不被未勾的验收标准挡住" || fail "close 不该查验收标准"
case "$(cli -C "$W" ls --closed 2>/dev/null | grep "$L")" in
  *unverified*) fail "正常取消的任务不该被标成 unverified" ;;
  *) ok "正常取消的任务不是未验证" ;;
esac

# 17. --force 越不过状态门禁（spec §6.1：它覆盖的是就绪判断，不是状态机）
M=$(cli -C "$W" --json add "state gate" | jfield id)
cli -C "$W" done "$M" >/dev/null 2>&1
cli -C "$W" done "$M" --force --reason "again" >/dev/null 2>&1
[ $? -eq 2 ] && ok "已关闭的任务 done --force 仍被拒（退出 2）" || fail "--force 越过了状态门禁"
n=$(grep -c ' done ' "$W/.todopi/tasks/$M.md")
[ "$n" -eq 1 ] && ok "只有一条 done 日志" || fail "写出了 $n 条 done 日志"
cli -C "$W" close "$M" -r wontfix --force --reason "rewrite" >/dev/null 2>&1
[ $? -eq 2 ] && ok "已关闭的任务 close --force 仍被拒" || fail "resolution 被改写了"
grep -q '^resolution: "done"$' "$W/.todopi/tasks/$M.md" && ok "resolution 没被改写" || fail "resolution 变了"

# 18. reopen 也查共享租约（D019 的边界，第四个入口）
N=$(cli -C "$W" --json add "worktree reopen" | jfield id)
cli -C "$W" done "$N" >/dev/null 2>&1
node -e '
const fs=require("node:fs"),p=process.argv[1];
const now=new Date().toISOString().replace(/\.\d{3}Z$/,"Z");
fs.writeFileSync(p, JSON.stringify({actor:"holder@host",claimed_at:now,heartbeat_at:now},null,2)+"\n");
' "$LEASES/$N.json"
cli -C "$W" reopen "$N" >/dev/null 2>&1
[ $? -eq 3 ] && ok "共享租约属于别人时 reopen 被拒（退出 3）" || fail "reopen 跳过了共享租约检查"
[ -f "$LEASES/$N.json" ] && ok "别人的活租约没被 reopen 删掉" || fail "reopen 删掉了别人的活租约"

# 19. CRLF 正文不会让门禁静默失效
O=$(cli -C "$W" --json add "crlf" --ac "not done yet" | jfield id)
node -e '
const fs=require("node:fs"),p=process.argv[1];
const raw=fs.readFileSync(p,"utf8"); const i=raw.indexOf("---",3)+4;
fs.writeFileSync(p, raw.slice(0,i) + raw.slice(i).replace(/\n/g,"\r\n"));
' "$W/.todopi/tasks/$O.md"
cli -C "$W" done "$O" >/dev/null 2>&1
[ $? -eq 2 ] && ok "CRLF 正文下门禁照常生效" || fail "CRLF 正文让门禁静默失效了"

# 20. **每一条 command 都真的能跑**，且覆盖全部场景
#
#     第一版这项有两个假绿：它**主动过滤掉了含 `<` 的项**（那些是模板，字面执行
#     会被 shell 的 `<` 当成重定向），而且只跑了 done/close 的一个场景。
#     现在：command 一条不漏地执行；template 单独断言它确实含占位符且**不**被执行。
run_actions() {
  local label="$1"; shift
  local json="$TMP/act.json"
  "$@" > "$json" 2>/dev/null
  node -e '
const fs=require("node:fs");
const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
if(!Array.isArray(r.actions)||r.actions.length===0) throw new Error("没有 actions");
for(const a of r.actions){
  if(a.command!==undefined && a.template!==undefined) throw new Error("同时给了 command 与 template");
  if(a.command!==undefined && /[<>]/.test(a.command)) throw new Error("command 含占位符: "+a.command);
  if(a.template!==undefined && !/[<>]/.test(a.template)) throw new Error("template 不含占位符: "+a.template);
  if(a.command!==undefined) console.log("CMD\t"+a.command);
  if(a.template!==undefined) console.log("TPL\t"+a.template);
  if(!a.detail) throw new Error("动作缺 detail");
}' "$json" > "$TMP/acts" 2>"$TMP/acterr"
  if [ $? -ne 0 ]; then fail "[$label] actions 不合格：$(cat "$TMP/acterr")"; return; fi

  local n=0
  while IFS="$(printf '\t')" read -r kind cmd; do
    [ -z "$cmd" ] && continue
    [ "$kind" = "TPL" ] && continue
    n=$((n + 1))
    real=$(printf '%s' "$cmd" | sed "s|^todopi |cli -C $W |")
    eval "$real" >/dev/null 2>&1
    code=$?
    # 1 = 用法错误，说明我们给了一条本身就写错的命令；2/3 是门禁没过，那是对的
    [ "$code" -eq 1 ] && fail "[$label] 命令是用法错误：$cmd"
    [ "$code" -gt 3 ] && fail "[$label] 命令退出 ${code}：$cmd"
  done < "$TMP/acts"
  ok "[$label] $n 条 command 全部可执行"
}

# 场景 a：验收标准 + 子任务
Q=$(cli -C "$W" --json add "runnable parent" --ac "todo" | jfield id)
cli -C "$W" --json add "runnable child" --parent "$Q" >/dev/null 2>&1
run_actions "done：标准+子任务" cli -C "$W" --json done "$Q"

# 场景 b：close 的归属冲突
Q2=$(cli -C "$W" --json add "runnable owned" | jfield id)
cli -C "$W" --as someone@host claim "$Q2" >/dev/null 2>&1
run_actions "close：归属冲突" cli -C "$W" --json close "$Q2" --resolution wontfix

# 场景 c：done 的状态门禁
Q3=$(cli -C "$W" --json add "runnable closed" | jfield id)
cli -C "$W" done "$Q3" >/dev/null 2>&1
run_actions "done：状态门禁" cli -C "$W" --json done "$Q3"

# 场景 d：reopen 的状态门禁
Q4=$(cli -C "$W" --json add "runnable open" | jfield id)
run_actions "reopen：状态门禁" cli -C "$W" --json reopen "$Q4"

# 场景 e：reopen 的归属冲突（活的共享租约）
Q5=$(cli -C "$W" --json add "runnable reopen owned" | jfield id)
cli -C "$W" done "$Q5" >/dev/null 2>&1
node -e '
const fs=require("node:fs"),p=process.argv[1];
const now=new Date().toISOString().replace(/\.\d{3}Z$/,"Z");
fs.writeFileSync(p, JSON.stringify({actor:"holder@host",claimed_at:now,heartbeat_at:now},null,2)+"\n");
' "$LEASES/$Q5.json"
run_actions "reopen：归属冲突" cli -C "$W" --json reopen "$Q5"

grep -q 'todopi check ' "$TMP/acts" && fail "建议了尚不存在的 todopi check" || ok "没有建议尚不存在的命令"

# 21. 过期的租约不该继续拦人（spec §8 的 stale 语义）
R=$(cli -C "$W" --json add "expired lease" | jfield id)
cli -C "$W" done "$R" >/dev/null 2>&1
node -e '
const fs=require("node:fs"),p=process.argv[1];
fs.writeFileSync(p, JSON.stringify({actor:"ghost@host",claimed_at:"2020-01-01T00:00:00Z",heartbeat_at:"2020-01-01T00:00:00Z"},null,2)+"\n");
' "$LEASES/$R.json"
cli -C "$W" reopen "$R" >/dev/null 2>&1
[ $? -eq 0 ] && ok "过期的孤儿租约不拦 reopen" || fail "过期租约把任务永远锁住了"

# 22. reopen 遇活租约时不建议 claim --steal（那条命令对 closed 任务必然失败）
S=$(cli -C "$W" --json add "reopen advice" | jfield id)
cli -C "$W" done "$S" >/dev/null 2>&1
node -e '
const fs=require("node:fs"),p=process.argv[1];
const now=new Date().toISOString().replace(/\.\d{3}Z$/,"Z");
fs.writeFileSync(p, JSON.stringify({actor:"holder@host",claimed_at:now,heartbeat_at:now},null,2)+"\n");
' "$LEASES/$S.json"
out="$(cli -C "$W" reopen "$S" 2>&1)"
# 检查的是「有没有一条 todopi … 命令带 --steal」，不是字符串出现过没有——
# 解释里那句「claim --steal 在这里不适用」是**有用的**，它提前挡住了 agent 去试。
if printf '%s' "$out" | grep -E '^\s*todopi .*--steal' >/dev/null; then
  fail "reopen 给出了对 closed 任务必然失败的 claim --steal 命令"
else
  ok "reopen 不给出 claim --steal 这条命令"
fi
case "$out" in *"No command available"*) ok "并且明说了这里没有可用的命令" ;; *) fail "没说清这里没有命令可跑" ;; esac
case "$out" in *holder@host*) ok "但说清了是谁持有" ;; *) fail "没说是谁持有" ;; esac

# 23. CRLF 正文被改写后规范化成 LF（spec §5.1：行尾 LF）
U=$(cli -C "$W" --json add "crlf normalize" | jfield id)
node -e '
const fs=require("node:fs"),p=process.argv[1];
const raw=fs.readFileSync(p,"utf8"); const i=raw.indexOf("---",3)+4;
fs.writeFileSync(p, raw.slice(0,i) + raw.slice(i).replace(/\n/g,"\r\n"));
' "$W/.todopi/tasks/$U.md"
cli -C "$W" done "$U" >/dev/null 2>&1
if grep -q $'\r' "$W/.todopi/tasks/$U.md"; then
  fail "改写之后正文仍是 CRLF —— 写者 MUST 发 LF（§5.1）"
else
  ok "改写之后正文规范化成 LF"
fi

# 24. 文本报告里出现的命令，恰好就是 --json actions 里的那些
V=$(cli -C "$W" --json add "same commands" --ac "x" | jfield id)
cli -C "$W" --json add "same child" --parent "$V" >/dev/null 2>&1
cli -C "$W" --json done "$V" 2>/dev/null > "$TMP/j.json"
cli -C "$W" done "$V" 2>/dev/null > "$TMP/t.txt"
if node -e '
const fs=require("node:fs");
const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const text=fs.readFileSync(process.argv[2],"utf8");
const fromJson=[...new Set(r.actions.flatMap(a=>[a.command,a.template]).filter(Boolean))].sort();
const inText=[...new Set(text.split("\n").map(l=>l.trim()).filter(l=>l.startsWith("todopi ")))].sort();
if(JSON.stringify(fromJson)!==JSON.stringify(inText))
  throw new Error("文本 "+JSON.stringify(inText)+" 与 JSON "+JSON.stringify(fromJson)+" 不一致");
' "$TMP/j.json" "$TMP/t.txt" 2>/dev/null; then
  ok "文本与 --json 给出的命令集合完全一致"
else
  fail "文本与 --json 的命令集合分叉了"
fi

[ "$FAILED" -eq 0 ] && { echo "f06-gates: pass"; exit 0; } || { echo "f06-gates: fail"; exit 1; }
