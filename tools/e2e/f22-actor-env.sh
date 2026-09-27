#!/usr/bin/env bash
# tools/e2e/f22-actor-env.sh —— F22 的 Layer 3：FR-C4 的 agent 环境推断。
# 各家 agent 的环境信号（D043 的一手证据）解析成 <agent>@<host>；嵌套时内层优先；--agent / TODOPI_AGENT 显式覆盖；
# 最要紧的一条：setup 写进各家配置的钩子命令（原样取出来跑）与 agent 自己在环境里跑的 claim 得到同一个 actor——
# 钩子里的 prime 认得出那个任务是「我的」。

set -u
unset CLAUDECODE CODEX_THREAD_ID GEMINI_CLI OPENCODE PI_SESSION_ID CURSOR_AGENT TODOPI_AGENT TODOPI_ACTOR
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
if [ -n "${TODOPI_E2E_BIN:-}" ]; then printf '#!/bin/sh\nexec "%s" "$@"\n' "$TODOPI_E2E_BIN"; else printf '#!/bin/sh\nexec node %s/src/cli.ts "$@"\n' "$ROOT"; fi > "$TMP/bin/todopi"
chmod +x "$TMP/bin/todopi"
export PATH="$TMP/bin:$PATH"
HOST="$(node -p 'require("os").hostname()')"

W="$TMP/w"
mkdir -p "$W"
git -C "$W" init -q
git -C "$W" config user.name "Test Human"
todopi -C "$W" init >/dev/null 2>&1
who() { todopi -C "$W" --json ls --all >/dev/null 2>&1; (cd "$W" && env "$@" todopi add probe >/dev/null && ID=$(todopi ls | tail -1 | cut -d' ' -f1) && env "$@" todopi claim "$ID" >/dev/null && todopi --json show "$ID" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).assignee)'); }

[ "$(who X=1)" = "test-human" ] && ok "普通终端：git 用户名" || fail "普通终端是 $(who X=1)"
for pair in "claude-code CLAUDECODE=1" "codex CODEX_THREAD_ID=t1" "gemini GEMINI_CLI=1" "opencode OPENCODE=1" "pi PI_SESSION_ID=s1" "cursor CURSOR_AGENT=1"; do
  name="${pair%% *}"; var="${pair#* }"
  got="$(who "$var")"
  [ "$got" = "${name}@${HOST}" ] && ok "${var} → ${name}@<host>" || fail "${var} 得到 ${got}"
done
got="$(who CLAUDECODE=1 CODEX_THREAD_ID=t1)"
[ "$got" = "test-human" ] && ok "不止一个信号（嵌套）：分不出哪层在跑，不推断，回退到 git 用户名" || fail "嵌套得到 ${got}"
got="$(who CODEX_THREAD_ID=outer GEMINI_CLI=1 TODOPI_AGENT=gemini)"
[ "$got" = "gemini@${HOST}" ] && ok "嵌套里的 agent 用 TODOPI_AGENT 说清楚" || fail "嵌套 + TODOPI_AGENT 得到 ${got}"
# --agent 只在本进程里：verify 起的子进程看不到它（否则里面再调的 todopi 会被记到这个 agent 名下）
(cd "$W" && todopi add "leak probe" --verify 'test -z "${TODOPI_AGENT:-}"' >/dev/null && ID=$(todopi ls | tail -1 | cut -d' ' -f1) \
  && todopi --agent codex claim "$ID" >/dev/null && todopi --agent codex done "$ID" --yes >/dev/null 2>&1) \
  && ok "--agent 不泄漏进 verify 的子进程" || fail "verify 看到了 TODOPI_AGENT"
got="$(who TODOPI_AGENT=pi CLAUDECODE=1)"
[ "$got" = "pi@${HOST}" ] && ok "TODOPI_AGENT 盖过环境信号" || fail "TODOPI_AGENT 得到 ${got}"
got="$(who TODOPI_ACTOR=boss CLAUDECODE=1)"
[ "$got" = "boss" ] && ok "TODOPI_ACTOR 盖过 agent 推断" || fail "TODOPI_ACTOR 得到 ${got}"
out="$(todopi -C "$W" --agent claude ls 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "claude-code" && ok "--agent 名字拼错：退出 1 并列出可用的名字" || fail "rc=${rc}：$out"

# 钩子与工具同一个 actor：setup 写出的命令原样取出来跑
for agent in claude codex gemini cursor; do
  R="$TMP/r-$agent"; mkdir -p "$R"; git -C "$R" init -q; git -C "$R" config user.name "Test Human"
  todopi -C "$R" init >/dev/null 2>&1
  todopi -C "$R" setup "$agent" >/dev/null 2>&1
  case "$agent" in
    claude) cfg="$R/.claude/settings.json"; sig="CLAUDECODE=1"; q='h.SessionStart[0].hooks[0].command' ;;
    codex)  cfg="$R/.codex/hooks.json";      sig="CODEX_THREAD_ID=t9"; q='h.SessionStart[0].hooks[0].command' ;;
    gemini) cfg="$R/.gemini/settings.json";  sig="GEMINI_CLI=1"; q='h.SessionStart[0].hooks[0].command' ;;
    cursor) cfg="$R/.cursor/hooks.json";     sig="CURSOR_AGENT=1"; q='h.sessionStart[0].command' ;;
  esac
  hookcmd="$(node -e "const h=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).hooks; console.log($q)" "$cfg")"
  (cd "$R" && todopi add "Task for $agent" >/dev/null && ID=$(todopi ls | cut -d' ' -f1) && env "$sig" todopi claim "$ID" >/dev/null)
  # 钩子子进程里没有 agent 的信号（只设给工具子进程）：只靠命令里的 --agent。prime 的「我的」是宽松匹配（@host 后缀就算），
  # 证明不了身份相同；写入端是严格匹配——所以用钩子命令的前缀（prime 之前的部分）去 release：身份一致才放行
  prefix="${hookcmd%% prime *}"
  out="$(cd "$R" && ID=$(todopi ls | cut -d' ' -f1) && sh -c "$prefix release $ID" 2>&1)"; rc=$?
  [ "$rc" -eq 0 ] && ok "${agent}：钩子命令（${prefix}）与 agent 在环境里 claim 的是同一个 actor（严格匹配的 release 放行）" || fail "${agent}：${prefix} release 退出 ${rc}：$out"
done

[ "$FAILED" -eq 0 ] && { echo "f22-actor-env: pass"; exit 0; } || { echo "f22-actor-env: fail"; exit 1; }
