#!/usr/bin/env bash
# tools/bench/ledger-2000.sh —— 2,000 个任务的账本上，常用读命令的耗时（PRD §10 性能一行，F29）。
#
# 不是门禁：CI 机器之间差得太多，阈值定在哪都会是假红或假绿。它保证的是**可复现**：谁都能在自己的机器上跑出同一张表，
# 贴回 PRD 时连同机器信息一起。CI 里只要求它跑得通（生成的账本通过 doctor，每条命令都成功）。
#
# 用法：bash tools/bench/ledger-2000.sh            跑编译后的 CLI（用户实际跑的就是它）
#       TODOPI_BENCH_BIN=/path/to/todopi bash …    跑指定的可执行文件（比如单二进制）
#       TODOPI_BENCH_RUNS=11 bash …                每条命令跑几次（默认 7，取中位数）
#       TODOPI_BENCH_MAX_MS=200 bash …             中位数超过它就退出 1（默认不设：只报告）
#       TODOPI_BENCH_KEEP=/some/dir bash …         把生成的账本留在那里（剖析用），不删
#
# 账本是直接生成的文件（用项目自己的发射器，逐字节与 CLI 写出的一样），2,000 次 `add` 要跑好几分钟；生成后先跑 doctor，
# 不合法就退出，免得测的是一个 CLI 自己都读不懂的账本。形状按下标**确定地**分配（不靠随机数凑比例），运行时再数一遍打印出来：
# 20 个容器（其余任务有一半挂在它们下面）、三成已关闭、一成进行中（其中恰好 5 个由跑 prime 的 actor 持有）、一成半有 blocked_by
# （指向更早的任务，不成环）、每个任务 3 条验收标准与 2–6 条 Log。

set -u
unset CLAUDECODE CODEX_THREAD_ID GEMINI_CLI OPENCODE PI_SESSION_ID CURSOR_AGENT TODOPI_AGENT TODOPI_ACTOR CI
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2
RUNS="${TODOPI_BENCH_RUNS:-7}"
MAX="${TODOPI_BENCH_MAX_MS:-}"
case "$RUNS" in ''|*[!0-9]*|0) echo "bench: TODOPI_BENCH_RUNS must be a positive integer, got '${RUNS}'" >&2; exit 2 ;; esac
case "$MAX" in *[!0-9]*) echo "bench: TODOPI_BENCH_MAX_MS must be a number of milliseconds, got '${MAX}'" >&2; exit 2 ;; esac
N=2000

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export TODOPI_CONFIG_DIR="$TMP/config"

# 现编一份 dist（不动仓库里的 dist/）：默认被测的就是它，与发布出去的 npm 包是同一种东西；生成器也从它导入发射器——
# Node 20（项目支持的最低版本）不能直接导入 .ts
node_modules/.bin/tsc -p tsconfig.build.json --outDir "$TMP/build/dist" || { echo "bench: build failed" >&2; exit 1; }
ln -s "$ROOT/node_modules" "$TMP/build/node_modules"
printf '{ "type": "module" }\n' > "$TMP/build/package.json"
if [ -n "${TODOPI_BENCH_BIN:-}" ]; then BIN=("$TODOPI_BENCH_BIN"); else BIN=(node "$TMP/build/dist/main.js"); fi

W="${TODOPI_BENCH_KEEP:-$TMP/ledger}"
if [ -e "$W" ] && [ -n "$(ls -A "$W" 2>/dev/null)" ]; then echo "bench: $W is not empty" >&2; exit 2; fi
mkdir -p "$W"
git -C "$W" init -q
git -C "$W" config user.name bench
"${BIN[@]}" -C "$W" --quiet init >/dev/null || { echo "bench: init failed" >&2; exit 1; }

node --no-warnings --input-type=module - "$W/.todopi/tasks" "$N" "$TMP/build/dist/format/emit.js" <<'EOF' || { echo "bench: generating the ledger failed" >&2; exit 1; }
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [dir, nText, emitPath] = process.argv.slice(2);
const { emitFrontmatter, nextRank } = await import(pathToFileURL(emitPath).href);
const n = Number(nText);
// id 与标题用固定种子的伪随机（看起来像真的）；形状（状态、依赖、Log 条数）按下标确定地分配，比例是精确的
let seed = 20260928;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rand() * a.length)];
const ids = [];
const seen = new Set();
const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
while (ids.length < n) {
  let id = "tp-";
  for (let i = 0; i < 6; i++) id += alphabet[Math.floor(rand() * 36)];
  if (!seen.has(id)) { seen.add(id); ids.push(id); }
}
const stamp = (i, extra = 0) => new Date(Date.UTC(2026, 0, 1) + i * 3600_000 + extra * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const CONTAINERS = 20;
let rank = null;
let benchHeld = 0;
for (let i = 0; i < n; i++) {
  const id = ids[i];
  rank = nextRank(rank);
  const container = i < CONTAINERS;
  const slot = i % 10;
  // 三成关闭（0–2）、一成进行中（3）、其余打开；容器永远打开
  const status = container ? "open" : slot <= 2 ? "closed" : slot === 3 ? "in_progress" : "open";
  // 进行中的前 5 个由 prime 的 actor（bench）持有，其余给别人
  const mine = status === "in_progress" && benchHeld < 5;
  if (mine) benchHeld++;
  const actor = mine ? "bench" : ["alice", "bob", "carol"][i % 3];
  // 一成半有 blocked_by：i % 20 ∈ {4, 11, 17}，指向 7 个之前的非容器任务（更早 ⇒ 不成环）
  const blocker = !container && [4, 11, 17].includes(i % 20) && i - 7 >= CONTAINERS ? ids[i - 7] : undefined;
  const fm = {
    id, title: `${pick(["Add", "Fix", "Refactor", "Document", "Test"])} ${pick(["login", "export", "search", "billing", "sync"])} ${pick(["flow", "cache", "API", "page", "job"])} #${i}`,
    status,
    resolution: status === "closed" ? "done" : undefined,
    assignee: status === "in_progress" ? actor : undefined,
    parent: !container && i % 2 === 0 ? ids[(i / 2) % CONTAINERS] : undefined,
    blocked_by: blocker === undefined ? undefined : [blocker],
    rank, verify: i % 2 === 1 ? "npm test" : undefined,
    labels: i % 5 < 2 ? [["backend", "frontend", "infra", "docs"][i % 4]] : undefined,
    created: stamp(i), updated: stamp(i, 30),
  };
  // Log 恰好 2–6 条：关闭的 = created + 3 条 check + done（5）+ 0–1 条 note；进行中 = created + claimed + 0–4 条 note；打开 = created + 1–5 条 note
  const log = [`${stamp(i)} ${actor} created`];
  const notes = status === "closed" ? i % 2 : status === "in_progress" ? i % 5 : 1 + (i % 5);
  if (status === "in_progress") log.push(`${stamp(i, 5)} ${actor} claimed`);
  for (let k = 0; k < notes; k++) log.push(`${stamp(i, 10 + k)} ${actor} note: progress on ${id}, step ${k + 1}`);
  const checked = status === "closed";
  if (checked) for (let k = 1; k <= 3; k++) log.push(`${stamp(i, 20 + k)} ${actor} check ac=${k}: criterion ${k}`);
  if (checked) log.push(`${stamp(i, 30)} ${actor} done verify=pass commit=abc1234 dirty=false`);
  const body = [
    "## Description", "", `Generated task ${i} for the benchmark.`, "",
    "## Acceptance Criteria", "", ...[1, 2, 3].map((k) => `- [${checked ? "x" : " "}] criterion ${k}`), "",
    "## Log", "", ...log.map((l) => `- ${l}`), "",
  ];
  writeFileSync(join(dir, `${id}.md`), ["---", emitFrontmatter(fm).trimEnd(), "---", "", ...body].join("\n"));
}
EOF

# 生成的账本必须合法：CLI 自己都读不懂的账本上测出来的数字没有意义
if ! out="$("${BIN[@]}" -C "$W" doctor 2>&1)"; then
  echo "bench: the generated ledger does not pass doctor:" >&2
  printf '%s\n' "$out" | head -20 >&2
  exit 1
fi
SHOW_ID="$(ls "$W/.todopi/tasks" | sed -n '1000p' | sed 's/\.md$//')"
# 形状用 CLI 自己的 --json 数一遍再印出来：描述与实际不符时一眼看得见
SHAPE="$("${BIN[@]}" -C "$W" ls --all --json | node --no-warnings -e '
  const t = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const c = (f) => t.filter(f).length;
  console.log(`${t.length} tasks: ${c((x) => x.status === "closed")} closed, ${c((x) => x.status === "in_progress")} in progress `
    + `(${c((x) => x.assignee === "bench")} held by the prime actor), ${c((x) => x.blocked_by.length > 0)} with blocked_by, `
    + `${c((x) => x.child_progress !== undefined)} containers, ${c((x) => x.parent !== undefined)} children`);')" \
  || { echo "bench: could not read the generated ledger back" >&2; exit 1; }

# 每条命令跑 RUNS 次，墙钟时间（含进程启动：这就是用户等的时间），先热身一次
bench() {
  node --no-warnings --input-type=module - "$RUNS" "$@" <<'EOF'
import { spawnSync } from "node:child_process";
const [runs, ...cmd] = process.argv.slice(2);
spawnSync(cmd[0], cmd.slice(1), { stdio: "ignore" });
const ms = [];
for (let i = 0; i < Number(runs); i++) {
  const t = process.hrtime.bigint();
  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, TODOPI_ACTOR: "bench" } });
  ms.push(Number(process.hrtime.bigint() - t) / 1e6);
  if (r.status !== 0) { console.error(`failed (exit ${r.status}): ${cmd.join(" ")}\n${r.stderr}`); process.exit(1); }
}
ms.sort((a, b) => a - b);
console.log([ms[Math.floor(ms.length / 2)], ms[0], ms.at(-1)].map((x) => x.toFixed(0)).join(" "));
EOF
}

FAILED=0
printf '\n%s\n%s runs each, wall-clock ms including process start (median / min / max)\n\n' "$SHAPE" "$RUNS"
printf '| %-26s | %6s | %5s | %5s |\n|%s|%s|%s|%s|\n' command median min max "----------------------------" "--------" "-------" "-------"
for c in "--version" "ls" "ls --ready" "ls --all" "ls --json" "prime" "prime --full" "show $SHOW_ID" "doctor"; do
  # shellcheck disable=SC2086
  r="$(bench "${BIN[@]}" -C "$W" $c)" || { FAILED=1; continue; }
  set -- $r
  label="${c/$SHOW_ID/<id>}"
  printf '| %-26s | %6s | %5s | %5s |\n' "todopi $label" "$1" "$2" "$3"
  if [ -n "$MAX" ] && [ "$1" -gt "$MAX" ]; then FAILED=1; fi
done

# CPU 型号：macOS 的 sysctl、x86 Linux 的 /proc/cpuinfo、ARM Linux 的 lscpu（它的 /proc/cpuinfo 没有 model name）
cpu() {
  local m
  m="$(sysctl -n machdep.cpu.brand_string 2>/dev/null)"
  [ -z "$m" ] && m="$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2)"
  [ -z "$m" ] && m="$(lscpu 2>/dev/null | grep -m1 'Model name' | cut -d: -f2)"
  m="$(printf '%s' "$m" | sed 's/^ *//')"
  # 虚拟机里的 lscpu 会给一个 "-"
  case "$m" in ''|-) m="unknown CPU" ;; esac
  printf '%s' "$m"
}
load="$(uptime 2>/dev/null | sed -n 's/.*load averages*: *//p')"
printf '\nmachine: %s %s, %s, %s cores, node %s; load average %s\n' "$(uname -s)" "$(uname -m)" "$(cpu)" \
  "$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo '?')" "$(node --version)" "${load:-unknown}"
[ -n "$MAX" ] && [ "$FAILED" -eq 1 ] && printf 'some median exceeded %s ms\n' "$MAX"
exit "$FAILED"
