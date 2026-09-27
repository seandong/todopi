#!/usr/bin/env bash
# tools/e2e/f05-claim.sh —— F05 的 Layer 3。
# 认领逻辑的正确性主要由 domain/ 的纯函数与 commands/ 的用例覆盖；
# 这里验证端到端真的接通了：退出码、租约文件的位置、Log 的内容、输出语言。

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
jfield() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s)[process.argv[1]])))' "$1"; }

W="$TMP/w"
mkdir -p "$W"
git -C "$W" init -q
git -C "$W" config user.name tester
cli -C "$W" init >/dev/null 2>&1
A=$(cli -C "$W" --json add "first task" | jfield id)
LEASES="$W/.git/todopi/leases"
TASK="$W/.todopi/tasks/$A.md"

# 1. 认领一个 open 任务
if cli -C "$W" claim "$A" >/dev/null 2>&1; then ok "claim 退出 0"; else fail "claim 应退出 0"; fi
grep -q '^status: "in_progress"$' "$TASK" && ok "状态变成 in_progress" || fail "状态没变"
grep -q '^assignee: "tester"$' "$TASK" && ok "assignee 写入" || fail "assignee 没写"
[ -f "$LEASES/$A.json" ] && ok "租约落在 .git/todopi/leases/（spec §8）" || fail "租约位置不对"
cli -C "$W" doctor >/dev/null 2>&1 && ok "认领后通过 doctor" || fail "认领后 doctor 不过"

# 2. 租约三个字段齐全 —— 按规格实现的第三方读者会拒绝缺字段的租约
if node -e '
const r=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));
for (const k of ["actor","claimed_at","heartbeat_at"]) if (!(k in r)) throw new Error("缺 "+k);
' "$LEASES/$A.json" 2>/dev/null; then ok "租约三个字段齐全"; else fail "租约字段不全"; fi

# 3. 别人认领未过期的租约 → 退出 3，且任务文件字节不变
before="$(cat "$TASK")"
cli -C "$W" --as other@host claim "$A" >/dev/null 2>&1
[ $? -eq 3 ] && ok "未过期的租约拒绝，退出 3" || fail "应退出 3（FR-Q2）"
[ "$(cat "$TASK")" = "$before" ] && ok "被拒绝的 claim 不改任务文件（spec §6.1）" || fail "被拒绝的 claim 改了文件"

# 4. --steal 覆盖
if cli -C "$W" --as other@host claim "$A" --steal >/dev/null 2>&1; then ok "--steal 退出 0"; else fail "--steal 应退出 0"; fi
grep -q 'claimed steal=true: tester' "$TASK" && ok "Log 记 steal=true 并写明被替换者" || fail "Log 没记对被替换者"
grep -q '"actor": "other@host"' "$LEASES/$A.json" && ok "租约换成新持有者" || fail "租约没换"

# 5. 本人 release
if cli -C "$W" --as other@host release "$A" >/dev/null 2>&1; then ok "release 退出 0"; else fail "release 应退出 0"; fi
grep -q '^status: "open"$' "$TASK" && ok "状态回到 open" || fail "状态没回到 open"
grep -q '^assignee:' "$TASK" && fail "open 时 assignee 必须缺席（不变量 3）" || ok "assignee 已清空"
[ -f "$LEASES/$A.json" ] && fail "租约应被删除" || ok "租约已删除"
grep -q ' released$' "$TASK" && ok "Log 记 released" || fail "Log 没记 released"

# 6. 别人持有时 release 被拒 → 退出 3
cli -C "$W" claim "$A" >/dev/null 2>&1
cli -C "$W" --as other@host release "$A" >/dev/null 2>&1
[ $? -eq 3 ] && ok "别人的任务 release 退出 3" || fail "应退出 3"

# 7. **陈旧的 in_progress 直接认领，无需 --steal**
#    这是 spec §6.1 写 reclaim 那一行的全部理由：§7.5 把陈旧任务放进 ready 队列，
#    队列摆出来而 claim 拒绝，两者自相矛盾。
#    改文件用 node 而不是 sed：BSD sed 不解释替换串里的 \n（F04 踩过）。
node -e '
const fs=require("node:fs"),p=process.argv[1];
fs.writeFileSync(p, fs.readFileSync(p,"utf8").replace(/^updated: ".*"$/m, "updated: \"2020-01-01T00:00:00Z\""));
' "$TASK"
rm -f "$LEASES/$A.json"          # 本机租约也没了，只能靠 updated 判断陈旧
if cli -C "$W" --as third@host claim "$A" >/dev/null 2>&1; then
  ok "陈旧的 in_progress 无需 --steal 即可认领"
else
  fail "陈旧任务应当可以直接认领（spec §6.1）"
fi
grep -q 'steal=true' "$TASK" && ok "重新认领同样记 steal=true" || fail "重新认领没记 steal"

# 8. ls --ready 给出的任务一定 claim 得动 —— 两处的 stale 判断必须同源
cli -C "$W" --as third@host release "$A" >/dev/null 2>&1
B=$(cli -C "$W" --json add "ready probe" | jfield id)
node -e '
const fs=require("node:fs"),p=process.argv[1];
fs.writeFileSync(p, fs.readFileSync(p,"utf8")
  .replace(/^status: "open"$/m, "status: \"in_progress\"\nassignee: \"ghost@elsewhere\"")
  .replace(/^updated: ".*"$/m, "updated: \"2020-01-01T00:00:00Z\""));
' "$W/.todopi/tasks/$B.md"
if cli -C "$W" ls --ready 2>/dev/null | grep -q "$B"; then
  if cli -C "$W" claim "$B" >/dev/null 2>&1; then
    ok "ls --ready 给出的任务 claim 得动"
  else
    fail "ready 队列摆出来的任务 claim 却拒绝 —— 两处 stale 判断分叉了"
  fi
else
  fail "陈旧的 in_progress 应当出现在 ready 队列里"
fi

# 9. closed 的任务不能认领 → 退出 2
C=$(cli -C "$W" --json add "closed one" | jfield id)
node -e '
const fs=require("node:fs"),p=process.argv[1];
fs.writeFileSync(p, fs.readFileSync(p,"utf8").replace(/^status: "open"$/m, "status: \"closed\"\nresolution: \"done\""));
' "$W/.todopi/tasks/$C.md"
cli -C "$W" claim "$C" >/dev/null 2>&1
[ $? -eq 2 ] && ok "closed 任务认领退出 2（门禁）" || fail "应退出 2"
[ -f "$LEASES/$C.json" ] && fail "被拒绝的 claim 不得留下租约" || ok "被拒绝的 claim 没留下租约"

# 10. 不存在的任务 → 1；非法的 --as → 1
cli -C "$W" claim tp-zzzzzz >/dev/null 2>&1
[ $? -eq 1 ] && ok "不存在的任务退出 1" || fail "应退出 1"
cli -C "$W" --as "bad actor" claim "$A" >/dev/null 2>&1
[ $? -eq 1 ] && ok "非法的 --as 退出 1" || fail "应退出 1"

# 11. 输出是英文，--json 可解析
out="$(cli -C "$W" claim "$A" 2>&1; cli -C "$W" release "$A" 2>&1)"
if printf '%s' "$out" | node -e 'process.exit(/[\u4e00-\u9fff]/u.test(require("fs").readFileSync(0, "utf8")) ? 0 : 1)'; then
  fail "claim/release 输出含中文（CLI 的 stdout 是产品表面，MUST 是英文）"
else
  ok "输出是英文"
fi
if cli -C "$W" --json claim "$A" 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const r=JSON.parse(s);
  for(const k of ["id","title","status","assignee","stolen","refreshed"]) if(!(k in r)) throw new Error("缺 "+k);
})'; then ok "--json 可解析且字段齐全"; else fail "--json 输出不合格"; fi

# 12. 带 external 的任务照常认领，那个键原样保留
D=$(cli -C "$W" --json add "has external" | jfield id)
node -e '
const fs=require("node:fs"),p=process.argv[1];
fs.writeFileSync(p, fs.readFileSync(p,"utf8").replace(/^status: "open"$/m,
  "status: \"open\"\nexternal:\n  linear:\n    id: \"ENG-1\""));
' "$W/.todopi/tasks/$D.md"
if cli -C "$W" claim "$D" >/dev/null 2>&1; then
  ok "带 external 的任务认领成功"
else
  fail "带 external 的任务认领失败（退出码非 0）"
fi
# 必须确认文件真的被重写过了（否则 grep 通过只是因为什么都没发生）
grep -q '^status: "in_progress"$' "$W/.todopi/tasks/$D.md" && ok "文件确实被重写" || fail "文件没被重写，后面的断言没有意义"
grep -q 'ENG-1' "$W/.todopi/tasks/$D.md" && ok "external 原样保留" || fail "external 丢了"
grep -q 'object Object' "$W/.todopi/tasks/$D.md" && fail "扩展字段被强转成字符串" || ok "扩展字段没有被强转"
cli -C "$W" doctor >/dev/null 2>&1 && ok "带 external 的任务认领后仍通过 doctor" || fail "doctor 不过"

# 12b. 扩展字段的各种形状：对象数组、含换行的值、数字、布尔
F=$(cli -C "$W" --json add "odd extensions" | jfield id)
node -e '
const fs=require("node:fs"),p=process.argv[1];
fs.writeFileSync(p, fs.readFileSync(p,"utf8").replace(/^status: "open"$/m,
  "status: \"open\"\nx-custom: [{\"k\": \"v\"}]\nx-text: \"line1\\nline2\"\nx-count: 5\nx-flag: true"));
' "$W/.todopi/tasks/$F.md"
if cli -C "$W" claim "$F" >/dev/null 2>&1; then ok "含怪值扩展字段的任务认领成功"; else fail "认领失败"; fi
grep -q 'object Object' "$W/.todopi/tasks/$F.md" && fail "对象数组被强转" || ok "对象数组保留"
grep -q '^x-count: 5$' "$W/.todopi/tasks/$F.md" && ok "数字仍是数字" || fail "数字被加了引号"
grep -q '^x-flag: true$' "$W/.todopi/tasks/$F.md" && ok "布尔仍是布尔" || fail "布尔被加了引号"
cli -C "$W" doctor >/dev/null 2>&1 && ok "怪值扩展字段认领后仍通过 doctor" || fail "doctor 不过"

# 12c. 跨 worktree：本地任务说 open，但共享租约是别人的活租约
G=$(cli -C "$W" --json add "worktree probe" | jfield id)
cli -C "$W" --as holder@host claim "$G" >/dev/null 2>&1
node -e '
const fs=require("node:fs"),p=process.argv[1];
fs.writeFileSync(p, fs.readFileSync(p,"utf8")
  .replace(/^status: "in_progress"$/m, "status: \"open\"")
  .replace(/^assignee: ".*"\n/m, ""));
' "$W/.todopi/tasks/$G.md"
cli -C "$W" --as newcomer@host claim "$G" >/dev/null 2>&1
[ $? -eq 3 ] && ok "别的 worktree 的活租约挡住了认领（spec §8）" || fail "覆盖了别人的活租约"
grep -q '"actor": "holder@host"' "$LEASES/$G.json" && ok "活租约没被覆盖" || fail "活租约被覆盖了"
if cli -C "$W" --as newcomer@host claim "$G" --steal >/dev/null 2>&1; then
  ok "--steal 可以接管跨 worktree 的活租约"
else
  fail "--steal 应当可以接管"
fi

# 12d. 校验失败的 claim 不得留下租约（spec §6.1）
H=$(cli -C "$W" --json add "will fail validation" | jfield id)
node -e '
const fs=require("node:fs"),p=process.argv[1];
fs.writeFileSync(p, fs.readFileSync(p,"utf8").replace(/^title: ".*"$/m, "title: \"\""));
' "$W/.todopi/tasks/$H.md"
cli -C "$W" claim "$H" >/dev/null 2>&1
[ -f "$LEASES/$H.json" ] && fail "校验失败的 claim 留下了租约" || ok "校验失败的 claim 没留下租约"
# 这个任务是故意造坏的，用完就得清掉——留在账本里会让后面每一次 doctor 都红
rm -f "$W/.todopi/tasks/$H.md"

# 12e. 键名不安全的扩展字段：# 开头会变成注释、含 ": " 会让文件读不回来
I=$(cli -C "$W" --json add "odd keys" | jfield id)
node -e '
const fs=require("node:fs"),p=process.argv[1];
fs.writeFileSync(p, fs.readFileSync(p,"utf8").replace(/^status: "open"$/m,
  "status: \"open\"\n\"#meta\": \"keep\"\n\"x-a: b\": \"keep\""));
' "$W/.todopi/tasks/$I.md"
if cli -C "$W" claim "$I" >/dev/null 2>&1; then ok "键名不安全的任务认领成功"; else fail "认领失败"; fi
n=$(grep -c 'keep' "$W/.todopi/tasks/$I.md")
[ "$n" -eq 2 ] && ok "两个怪键都保留了" || fail "怪键丢了，只剩 $n 个"
cli -C "$W" doctor >/dev/null 2>&1 && ok "怪键任务认领后仍通过 doctor" || fail "doctor 不过"

# 12f. release 也要看共享租约：本树 assignee 还记着我，但租约已是别人的
J=$(cli -C "$W" --json add "release gate" | jfield id)
cli -C "$W" --as owner@host claim "$J" >/dev/null 2>&1
node -e '
const fs=require("node:fs"),p=process.argv[1];
const now=new Date().toISOString().replace(/\.\d{3}Z$/,"Z");
fs.writeFileSync(p, JSON.stringify({actor:"taker@host",claimed_at:now,heartbeat_at:now},null,2)+"\n");
' "$LEASES/$J.json"
cli -C "$W" --as owner@host release "$J" >/dev/null 2>&1
[ $? -eq 3 ] && ok "共享租约已换人时 release 被拒（退出 3）" || fail "旧持有者删掉了别人的活租约"
grep -q '"actor": "taker@host"' "$LEASES/$J.json" && ok "别人的活租约没被删" || fail "活租约被删了"

# 13. 并发：N 个进程同时认领，恰好一个成功
E=$(cli -C "$W" --json add "contested" | jfield id)
pids=""; okfile="$TMP/ok"; : > "$okfile"
for i in $(seq 1 20); do
  ( cli -C "$W" --as "w$i@host" claim "$E" >/dev/null 2>&1 && echo x >> "$okfile" ) &
  pids="$pids $!"
done
for p in $pids; do wait "$p"; done
n=$(wc -l < "$okfile" | tr -d ' ')
[ "$n" -eq 1 ] && ok "20 个并发 claim 恰好一个成功" || fail "应恰好一个成功，实际 $n"
holder=$(grep '^assignee:' "$W/.todopi/tasks/$E.md" | sed 's/assignee: "\(.*\)"/\1/')
if grep -q "\"actor\": \"$holder\"" "$LEASES/$E.json"; then
  ok "任务文件与租约指向同一个赢家"
else
  fail "任务文件说 ${holder}，租约说的是别人"
fi

[ "$FAILED" -eq 0 ] && { echo "f05-claim: pass"; exit 0; } || { echo "f05-claim: fail"; exit 1; }
