#!/usr/bin/env bash
# tools/e2e/f04-ls.sh —— F04 的 Layer 3。
# ls 的正确性主要由 domain/ 的纯函数用例覆盖；这里只验证端到端真的接通了：
# 退出码、过滤、排序、--json 可解析、输出语言、别名。

set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cli() { node "$ROOT/src/cli.ts" "$@"; }
# 从 --json 输出里取一个字段。用 node 而不是 grep/sed：JSON 得用 JSON 解析器读。
jfield() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s)[process.argv[1]])))' "$1"; }

W="$TMP/w"
mkdir -p "$W"
cli -C "$W" init >/dev/null 2>&1
A=$(cli -C "$W" --json add "first task" | jfield id)
B=$(cli -C "$W" --json add "second task" | jfield id)
cli -C "$W" add "blocked task" --blocked-by "$A" >/dev/null 2>&1

# 1. 基本列出
if out="$(cli -C "$W" ls 2>&1)"; then ok "ls 退出 0"; else fail "ls 应退出 0"; fi
case "$out" in *"first task"*) ok "列出了任务" ;; *) fail "没列出任务：$out" ;; esac

# 2. 顺序：创建顺序即 rank 顺序
first_line="$(cli -C "$W" ls | head -1)"
case "$first_line" in *"$A"*) ok "顺序符合 spec §7.4" ;; *) fail "第一行应是 $A：$first_line" ;; esac

# 3. --ready 排除被阻塞的
out="$(cli -C "$W" ls --ready 2>&1)"
case "$out" in *"blocked task"*) fail "被阻塞的不该在 ready 队列" ;; *) ok "--ready 排除被阻塞的" ;; esac

# 4. --blocked 只列被阻塞的
out="$(cli -C "$W" ls --blocked 2>&1)"
case "$out" in *"blocked task"*) ok "--blocked 列出被阻塞的" ;; *) fail "--blocked 没列出：$out" ;; esac
case "$out" in *"first task"*) fail "--blocked 不该列出未被阻塞的" ;; *) ok "--blocked 只列被阻塞的" ;; esac

# 5. --limit 生效，坏的 --limit 报用法错误而不是悄悄不限
n=$(cli -C "$W" ls --limit 1 | grep -c '^tp-')
if [ "$n" -eq 1 ]; then ok "--limit 生效"; else fail "--limit 1 应只有 1 行，实际 $n"; fi
cli -C "$W" ls --limit abc >/dev/null 2>&1
[ $? -eq 1 ] && ok "坏的 --limit 退出 1" || fail "坏的 --limit 应退出 1（FR-Q2）"
cli -C "$W" ls --all --closed >/dev/null 2>&1
[ $? -eq 1 ] && ok "互斥选项退出 1" || fail "互斥选项应退出 1"

# 6. 默认隐藏已关闭的（手工把一个任务改成 closed —— done 要到 F06）
#    用 node 而不是 sed：BSD sed 不解释替换串里的 \n，会写出 "closed"nresolution:
node -e '
const fs=require("node:fs"), p=process.argv[1];
fs.writeFileSync(p, fs.readFileSync(p,"utf8").replace(/^status: "open"$/m, "status: \"closed\"\nresolution: \"done\""));
' "$W/.todopi/tasks/$B.md"
cli -C "$W" doctor >/dev/null 2>&1 || fail "手工改出的 closed 任务应当通过 doctor"
out="$(cli -C "$W" ls 2>&1)"
case "$out" in *"$B"*) fail "默认不该列出已关闭的" ;; *) ok "默认隐藏已关闭的" ;; esac
out="$(cli -C "$W" ls --closed 2>&1)"
case "$out" in *"$B"*) ok "--closed 列出已关闭的" ;; *) fail "--closed 没列出：$out" ;; esac

# 7. --json 可解析且含派生态字段
if cli -C "$W" --json ls | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const r=JSON.parse(s);
  if(!Array.isArray(r.tasks)) throw new Error("tasks 不是数组");
  if(typeof r.total!=="number") throw new Error("缺 total");
  if(!Array.isArray(r.unreadable)) throw new Error("缺 unreadable");
  for(const k of ["id","title","status","ready","blocked","stale","mine","blocked_by","labels"])
    if(!(k in r.tasks[0])) throw new Error("缺字段 "+k);
})'; then
  ok "--json 可解析且含派生态字段"
else
  fail "--json 输出不合格"
fi

# 8. 输出是英文
out="$(cli -C "$W" ls 2>&1)"
if printf '%s' "$out" | grep -q '[一-鿿]'; then
  fail "ls 输出含中文（CLI 的 stdout 是产品表面，MUST 是英文）：$out"
else
  ok "ls 输出是英文"
fi

# 9. 空账本有明确提示
mkdir -p "$TMP/empty"; cli -C "$TMP/empty" init >/dev/null 2>&1
out="$(cli -C "$TMP/empty" ls 2>&1)"
case "$out" in *"No tasks"*) ok "空账本有明确提示" ;; *) fail "空账本提示不明确：$out" ;; esac

# 10. ready 是 ls --ready 的别名（FR-G2），且接受基础命令的选项
if [ "$(cli -C "$W" ready)" = "$(cli -C "$W" ls --ready)" ]; then ok "ready 是 ls --ready 的别名"; else fail "别名输出不一致"; fi
if cli -C "$W" ready --limit 1 >/dev/null 2>&1; then ok "别名接受基础命令的选项"; else fail "ready --limit 被拒，那就不是别名"; fi

# 11. 读不出来的文件被报告，而不是当成幽灵任务列出来
printf 'no envelope here\n' > "$W/.todopi/tasks/tp-zzzzzz.md"
out="$(cli -C "$W" ls 2>&1)"
case "$out" in *"tp-zzzzzz"*) ok "坏文件在输出里看得见" ;; *) fail "坏文件被悄悄吞了：$out" ;; esac
case "$out" in *doctor*) ok "并指向 doctor" ;; *) fail "没指向能查明白的命令" ;; esac
rm -f "$W/.todopi/tasks/tp-zzzzzz.md"

[ "$FAILED" -eq 0 ] && { echo "f04-ls: pass"; exit 0; } || { echo "f04-ls: fail"; exit 1; }
