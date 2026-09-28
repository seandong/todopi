#!/usr/bin/env bash
# tools/e2e/f21-install.sh —— F21 的 Layer 3。
# 1. npm 包：打包（tsc 逐文件编译，不打包）、纯 JS、依赖在白名单内、engines；用 install.sh 的 npm 路径装进一个空 HOME，跑第一条命令。
#    有 docker 时再在 node:20.0.0 的干净容器里 npm i -g 这个包、跑第一条命令（Node ≥ 20 的下限）。
# 2. install.sh 的二进制路径：用一个假的「二进制」（shell 脚本）做发布资产，离线（file://）测选择逻辑、SHA-256 校验、
#    归档条目检查（绝对路径、..、多余条目）、装到 ~/.local/bin、PATH 提示、钉版本、/latest 的 302 解析。
#    真的 Bun 二进制在干净容器里的测试在 .github/workflows/install.yml（有 Node / 无 Node 各一次）。

set -u
# 与跑它的 agent 无关（F22）：agent 的环境信号会让默认身份变成 <agent>@<host>，脚本里的身份断言按 git 用户名写
unset CLAUDECODE CODEX_THREAD_ID GEMINI_CLI OPENCODE PI_SESSION_ID CURSOR_AGENT TODOPI_AGENT TODOPI_ACTOR
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
ok()   { printf '  pass  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }
note() { printf '  note  %s\n' "$1"; }

TMP="$(mktemp -d)"
SERVER=""
trap '[ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null; rm -rf "$TMP"' EXIT

# ---- npm 包 ----
npm pack --pack-destination "$TMP" >/dev/null 2>&1
TGZ="$(ls "$TMP"/todopi-*.tgz 2>/dev/null | head -1)"
[ -f "$TGZ" ] && ok "npm pack 出包" || { fail "npm pack 失败"; echo "f21-install: fail"; exit 1; }
VERSION="$(node -p 'require("./package.json").version')"
mkdir -p "$TMP/unpacked" && tar -xzf "$TGZ" -C "$TMP/unpacked"
PKG="$TMP/unpacked/package"
[ -z "$(cd "$PKG" && find . -type f ! -name '*.js' ! -name '*.json' ! -name '*.md' ! -name 'LICENSE')" ] && [ -z "$(find "$PKG" -name '*.ts')" ] \
  && ok "包里只有 JS（与 JSON / 文档），没有 .ts、没有二进制" || fail "包里有别的文件：$(cd "$PKG" && find . -type f ! -name '*.js' ! -name '*.json' ! -name '*.md' ! -name 'LICENSE' | head -5)"
nsrc="$(find src -name '*.ts' | wc -l | tr -d ' ')"; ndist="$(find "$PKG/dist" -name '*.js' | wc -l | tr -d ' ')"
[ "$nsrc" = "$ndist" ] && ok "不 bundle：dist 与 src 逐文件对应（${ndist} 个）" || fail "src ${nsrc} 个 .ts，dist ${ndist} 个 .js"
node -e '
const p = require(process.argv[1]);
const ok = p.engines && p.engines.node === ">=20" && p.bin.todopi === "dist/main.js"
  && Object.keys(p.dependencies).every((d) => ["yaml","commander","fractional-indexing","commonmark"].includes(d));
process.exit(ok ? 0 : 1);' "$PKG/package.json" && ok "engines node >=20、bin 指向 dist/main.js、依赖都在 ARCH-010 的白名单内" || fail "package.json 不对"
head -1 "$PKG/dist/main.js" | grep -q '^#!/usr/bin/env node$' && ok "入口带 shebang" || fail "dist/main.js 没有 shebang"

A="$TMP/homeA"; mkdir -p "$A"
out="$(HOME="$A" TODOPI_VERSION="$VERSION" TODOPI_NPM_SPEC="$TGZ" sh ./install.sh 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -x "$A/.local/bin/todopi" ] && printf '%s' "$out" | grep -q "installing the npm package" \
  && ok "install.sh：有 Node ≥ 20 时装 npm 包，装到 ~/.local/bin" || fail "rc=${rc}：$out"
printf '%s' "$out" | grep -q "is not on your PATH" && ok "~/.local/bin 不在 PATH 时提示怎么加" || fail "没有 PATH 提示：$out"
# 装出来的每个依赖（含间接依赖）的 engines 都要接受 Node 20.0.0（F21 评审：commander 15 要 >=22.12，engine-strict 下装不上）
node -e '
const fs = require("fs"), path = require("path");
const ver = [20, 0, 0];
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); return 0; };
const parse = (v) => v.replace(/^v/, "").split(".").map((x) => Number(x));
function ok1(r) { // 一个比较集：空格分开的若干条件，全部满足
  return r.trim().split(/\s+/).filter(Boolean).every((c) => {
    if (c === "*" || c === "x") return true;
    let m;
    if ((m = /^>=\s*(.+)$/.exec(c))) return cmp(ver, parse(m[1])) >= 0;
    if ((m = /^>\s*(.+)$/.exec(c))) return cmp(ver, parse(m[1])) > 0;
    if ((m = /^<\s*(.+)$/.exec(c))) return cmp(ver, parse(m[1])) < 0;
    if ((m = /^\^(\d+)/.exec(c))) return ver[0] === Number(m[1]) && cmp(ver, parse(c.slice(1))) >= 0;
    throw new Error("unknown range " + c);
  });
}
const sat = (range) => range.replace(/>=\s+/g, ">=").split("||").some(ok1);
const root = process.argv[1], bad = [];
for (const name of fs.readdirSync(root).filter((n) => !n.startsWith("."))) {
  const pj = JSON.parse(fs.readFileSync(path.join(root, name, "package.json"), "utf8"));
  const r = pj.engines && pj.engines.node;
  if (r && !sat(r)) bad.push(name + " " + r);
}
if (bad.length) { console.error(bad.join("; ")); process.exit(1); }' "$A/.local/lib/node_modules/todopi/node_modules" 2>"$TMP/engines.err" \
  && ok "装出来的依赖（含间接）的 engines 都接受 Node 20.0.0" || fail "依赖的 engines 不接受 Node 20：$(cat "$TMP/engines.err")"
R="$TMP/repoA"; mkdir -p "$R"; git -C "$R" init -q
(cd "$R" && "$A/.local/bin/todopi" init >/dev/null 2>&1 && "$A/.local/bin/todopi" add "first" >/dev/null 2>&1 && "$A/.local/bin/todopi" ls | grep -q first) \
  && ok "装好的命令跑通第一条命令（init / add / ls）" || fail "装好的 todopi 跑不通"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  out="$(docker run --rm -v "$TGZ:/pkg.tgz:ro" node:20.0.0-slim sh -c 'npm i -g /pkg.tgz >/dev/null 2>&1 && cd /tmp && todopi init >/dev/null && todopi add first --verify "true" >/dev/null && ID=$(todopi ls | cut -d" " -f1) && todopi --as ci claim $ID >/dev/null && todopi --as ci done $ID --yes 2>/dev/null && todopi ls --all && node --version' 2>&1)"; rc=$?
  [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -qE "^tp-[a-z0-9]+ +done +first$" && printf '%s' "$out" | grep -q "^v20.0.0$" \
    && ok "干净的 node:20.0.0 容器里 npm i -g 这个包、跑通第一条命令与 done（走 dist 里的 verify runner）" || fail "node:20.0.0 容器：rc=${rc}：$out"
else
  note "没有 docker：Node 20.0.0 的干净容器测试跳过（.github/workflows/install.yml 里覆盖）"
fi

# ---- 二进制路径（假资产，离线）----
case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) os=unknown ;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) arch=unknown ;; esac
FV="9.9.9"
REL="$TMP/rel"
mkdir -p "$REL/v$FV" "$TMP/fake"
printf '#!/bin/sh\necho "%s-fake"\n' "$FV" > "$TMP/fake/todopi"; chmod +x "$TMP/fake/todopi"
ASSET="todopi-${FV}-${os}-${arch}.tar.gz"
tar -czf "$REL/v$FV/$ASSET" -C "$TMP/fake" todopi
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
printf '%s  %s\n' "$(sha "$REL/v$FV/$ASSET")" "$ASSET" > "$REL/v$FV/SHA256SUMS"

binstall() { # binstall <home> [env...]：离线装二进制；输出与退出码
  h="$1"; shift
  mkdir -p "$h"
  env HOME="$h" TODOPI_VERSION="$FV" TODOPI_DOWNLOAD_BASE="file://$REL" "$@" sh ./install.sh 2>&1
}

out="$(binstall "$TMP/b1" TODOPI_FORCE_BINARY=1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$("$TMP/b1/.local/bin/todopi")" = "$FV-fake" ] && printf '%s' "$out" | grep -q "checksum verified" \
  && ok "二进制路径：下载、SHA-256 校验通过、装到 ~/.local/bin" || fail "rc=${rc}：$out"

# 没有 Node 的 PATH：只放安装器要用的工具
NB="$TMP/nonode"; mkdir -p "$NB"
for t in sh curl tar gzip awk cut mktemp uname mkdir chmod mv rm cp dirname basename sha256sum shasum cat env head tr find id; do
  p="$(command -v "$t" 2>/dev/null)" && ln -sf "$p" "$NB/$t"
done
out="$(PATH="$NB" binstall "$TMP/b2")"; rc=$?
[ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "no Node.js >= 20 found" && [ -x "$TMP/b2/.local/bin/todopi" ] \
  && ok "PATH 上没有 Node：自动走二进制" || fail "rc=${rc}：$out"
printf '#!/bin/sh\necho 18\n' > "$NB/node"; chmod +x "$NB/node"
out="$(PATH="$NB" binstall "$TMP/b3")"; rc=$?
[ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "no Node.js >= 20 found" && ok "Node 18：不够 20，走二进制" || fail "rc=${rc}：$out"

# 校验不通过 / 没有 SHA256SUMS：拒绝，什么都不装
cp "$REL/v$FV/SHA256SUMS" "$TMP/sums.bak"
printf '%s  %s\n' "0000000000000000000000000000000000000000000000000000000000000000" "$ASSET" > "$REL/v$FV/SHA256SUMS"
out="$(binstall "$TMP/b4" TODOPI_FORCE_BINARY=1)"; rc=$?
[ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "checksum mismatch" && [ ! -e "$TMP/b4/.local/bin/todopi" ] \
  && ok "SHA-256 不符：拒绝安装，什么都没装" || fail "rc=${rc}：$out"
rm "$REL/v$FV/SHA256SUMS"
out="$(binstall "$TMP/b5" TODOPI_FORCE_BINARY=1)"; rc=$?
[ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "refusing to install an unverified binary" && [ ! -e "$TMP/b5/.local/bin/todopi" ] \
  && ok "没有 SHA256SUMS：拒绝安装" || fail "rc=${rc}：$out"
out="$(binstall "$TMP/b6" TODOPI_FORCE_BINARY=1 TODOPI_SKIP_CHECKSUM=1)"; rc=$?
[ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "WARNING: TODOPI_SKIP_CHECKSUM=1" && ok "显式跳过校验：装上并告警" || fail "rc=${rc}：$out"
cp "$TMP/sums.bak" "$REL/v$FV/SHA256SUMS"

# 恶意归档：条目在解压之前检查。归档用 node 手写 tar 头，名字原样写进去（系统 tar 会替你去掉开头的 / 与 ..）
evil() { # evil <entry name>...：写一个含这些条目的 tar.gz 当资产，并更新校验和
  node -e '
const zlib = require("zlib"), fs = require("fs");
const blocks = [];
for (const arg of process.argv.slice(1)) {
  // name 或 name=>linktarget（符号链接条目）
  const [name, link] = arg.split("=>");
  const body = link === undefined ? Buffer.from("#!/bin/sh\necho evil\n") : Buffer.alloc(0);
  const h = Buffer.alloc(512);
  h.write(name, 0, 100); h.write("0000755\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
  h.write(body.length.toString(8).padStart(11, "0") + "\0", 124); h.write("00000000000\0", 136);
  h.write("        ", 148); h.write(link === undefined ? "0" : "2", 156); if (link !== undefined) h.write(link, 157, 100);
  h.write("ustar\0", 257); h.write("00", 263);
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
}
blocks.push(Buffer.alloc(1024));
fs.writeFileSync(process.env.OUT, zlib.gzipSync(Buffer.concat(blocks)));' "$@"
}
for case in "/tmp/todopi-evil-abs|absolute path" "../todopi|contains .." "a/../../todopi|contains .." "todopi evil-extra|unexpected archive entry" "todopi=>/etc/hosts|not contain a regular file"; do
  names="${case%%|*}"; want="${case#*|}"
  # shellcheck disable=SC2086
  OUT="$REL/v$FV/$ASSET" evil $names
  printf '%s  %s\n' "$(sha "$REL/v$FV/$ASSET")" "$ASSET" > "$REL/v$FV/SHA256SUMS"
  h="$TMP/evil-$(printf '%s' "$names" | tr -c 'a-z' '_')"
  out="$(binstall "$h" TODOPI_FORCE_BINARY=1)"; rc=$?
  [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "$want" && [ ! -e "$h/.local/bin/todopi" ] && [ ! -e /tmp/todopi-evil-abs ] \
    && ok "归档条目 ${names}：解压前拒绝（${want}）" || fail "${names}：rc=${rc}：$out"
done
tar -czf "$REL/v$FV/$ASSET" -C "$TMP/fake" todopi
printf '%s  %s\n' "$(sha "$REL/v$FV/$ASSET")" "$ASSET" > "$REL/v$FV/SHA256SUMS"

# npm 这条路走不通时退回二进制（F21 评审）：有 Node 没有 npm；npm 装不上（包不存在）；之前装过二进制、npm 撞上已有文件
NN="$TMP/nodenonpm"; mkdir -p "$NN"
for t in sh curl tar gzip awk cut mktemp uname mkdir chmod mv rm cp dirname basename sha256sum shasum cat env head tr find id node; do
  p="$(command -v "$t" 2>/dev/null)" && ln -sf "$p" "$NN/$t"
done
out="$(PATH="$NN" binstall "$TMP/c1")"; rc=$?
[ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "npm is not" && [ "$("$TMP/c1/.local/bin/todopi")" = "$FV-fake" ] \
  && ok "有 Node 没有 npm：装二进制" || fail "rc=${rc}：$out"
out="$(binstall "$TMP/c2" TODOPI_NPM_SPEC="$TMP/does-not-exist.tgz")"; rc=$?
[ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "WARNING: npm could not install" && [ "$("$TMP/c2/.local/bin/todopi")" = "$FV-fake" ] \
  && ok "npm 装不上：说明原因、退回二进制" || fail "rc=${rc}：$out"
out="$(binstall "$TMP/c1" TODOPI_NPM_SPEC="$TGZ")"; rc=$?
[ "$rc" -eq 0 ] && [ -x "$TMP/c1/.local/bin/todopi" ] && "$TMP/c1/.local/bin/todopi" --version >/dev/null 2>&1 \
  && ok "之前装过二进制、再走 npm：不失败（npm 撞上已有文件时退回二进制）" || fail "rc=${rc}：$out"

# 二进制在这台机器上跑不起来（musl 之类）：拒绝，不报「装好了」
mkdir -p "$TMP/broken"; printf '#!/bin/sh\nexit 127\n' > "$TMP/broken/todopi"; chmod +x "$TMP/broken/todopi"
tar -czf "$REL/v$FV/$ASSET" -C "$TMP/broken" todopi
printf '%s  %s\n' "$(sha "$REL/v$FV/$ASSET")" "$ASSET" > "$REL/v$FV/SHA256SUMS"
out="$(binstall "$TMP/c3" TODOPI_FORCE_BINARY=1)"; rc=$?
[ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "does not run on this system" && [ ! -e "$TMP/c3/.local/bin/todopi" ] \
  && ok "二进制跑不起来：拒绝安装，什么都没装" || fail "rc=${rc}：$out"
tar -czf "$REL/v$FV/$ASSET" -C "$TMP/fake" todopi
printf '%s  %s\n' "$(sha "$REL/v$FV/$ASSET")" "$ASSET" > "$REL/v$FV/SHA256SUMS"

# npm 装过（tp 是指向 npm 包的链接）、这次 npm 失败改装二进制：tp 也改指向二进制，不留旧版本
out="$(binstall "$TMP/c5" TODOPI_NPM_SPEC="$TGZ")"; rc=$?
[ -L "$TMP/c5/.local/bin/tp" ] || fail "npm 路径没装出 tp 链接：$out"
out="$(binstall "$TMP/c5" TODOPI_NPM_SPEC="$TMP/does-not-exist.tgz")"; rc=$?
[ "$rc" -eq 0 ] && [ "$(readlink "$TMP/c5/.local/bin/tp")" = "todopi" ] && [ "$("$TMP/c5/.local/bin/tp")" = "$FV-fake" ] \
  && ok "npm 失败改装二进制时，旧 npm 留下的 tp 也改指向二进制" || fail "tp 仍指向 $(readlink "$TMP/c5/.local/bin/tp")：$out"
out="$(binstall "$TMP/c6" TODOPI_INSTALL_DIR="$TMP/c6/tools")"; rc=$?
[ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "is not one; installing the binary" && [ -x "$TMP/c6/tools/todopi" ] \
  && ok "安装目录不叫 bin：说明为什么不用 npm、装二进制" || fail "rc=${rc}：$out"

# /tmp 挂成 noexec 的机器：试跑在安装目录里做，照样装得上（F21 复审：在临时目录里试跑会误判「跑不起来」）
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  for a in x64 arm64; do
    L="todopi-${FV}-linux-${a}.tar.gz"
    cp "$REL/v$FV/$ASSET" "$REL/v$FV/$L" 2>/dev/null || true
    grep -q " $L\$" "$REL/v$FV/SHA256SUMS" || printf '%s  %s\n' "$(sha "$REL/v$FV/$L")" "$L" >> "$REL/v$FV/SHA256SUMS"
  done
  out="$(docker run --rm --tmpfs /tmp:rw,noexec -v "$REL:/rel:ro" -v "$ROOT/install.sh:/install.sh:ro" node:22-bookworm sh -c \
    'TODOPI_VERSION=9.9.9 TODOPI_DOWNLOAD_BASE=file:///rel TODOPI_FORCE_BINARY=1 sh /install.sh && ~/.local/bin/todopi' 2>&1)"; rc=$?
  [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "^${FV}-fake$" && ok "/tmp 挂成 noexec：照样装得上" || fail "noexec /tmp：rc=${rc}：$out"
else
  note "没有 docker：noexec /tmp 的用例跳过"
fi

# 安装目录里的临时文件名不可预测（mktemp），也不留下：预先放好的 PID 名链接不会被跟随（Codex 补审）
out="$(binstall "$TMP/c8" TODOPI_FORCE_BINARY=1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$(ls -A "$TMP/c8/.local/bin" | grep '^\.todopi\.new')" ] && ok "安装后不留临时文件" || fail "rc=${rc}：$(ls -A "$TMP/c8/.local/bin")"
grep -q 'mktemp "$INSTALL_DIR/.todopi.new.XXXXXX"' install.sh && ! grep -q '\.todopi\.new\.\$\$' install.sh \
  && ok "安装目录里的临时文件用 mktemp 独占创建，不用可预测的 PID 名" || fail "install.sh 仍用 PID 名的临时文件"

# 安装目录别人可写（组可写 / 所有人可写）：拒绝——在那种目录里写文件做不到无竞态（Codex 补审复核）
mkdir -p "$TMP/c9/shared"; chmod 775 "$TMP/c9/shared"
out="$(binstall "$TMP/c9" TODOPI_FORCE_BINARY=1 TODOPI_INSTALL_DIR="$TMP/c9/shared")"; rc=$?
[ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "writable by other users" && [ ! -e "$TMP/c9/shared/todopi" ] \
  && ok "组可写的安装目录：拒绝安装" || fail "rc=${rc}：$out"
chmod 757 "$TMP/c9/shared"
out="$(binstall "$TMP/c9" TODOPI_FORCE_BINARY=1 TODOPI_INSTALL_DIR="$TMP/c9/shared")"; rc=$?
[ "$rc" -ne 0 ] && [ ! -e "$TMP/c9/shared/todopi" ] && ok "所有人可写的安装目录：拒绝安装" || fail "rc=${rc}：$out"
chmod 755 "$TMP/c9/shared"
# 上级目录别人可写（可以把整个安装目录换掉）、安装目录是符号链接、安装目录带 ACL：都拒绝（Codex 补审复核）
mkdir -p "$TMP/c10/open/bin"; chmod 777 "$TMP/c10/open"
out="$(binstall "$TMP/c10" TODOPI_FORCE_BINARY=1 TODOPI_INSTALL_DIR="$TMP/c10/open/bin")"; rc=$?
[ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "c10/open is owned by another user or writable" && [ ! -e "$TMP/c10/open/bin/todopi" ] \
  && ok "上级目录别人可写：拒绝安装" || fail "rc=${rc}：$out"
chmod 1777 "$TMP/c10/open"
out="$(binstall "$TMP/c10" TODOPI_FORCE_BINARY=1 TODOPI_INSTALL_DIR="$TMP/c10/open/bin")"; rc=$?
[ "$rc" -eq 0 ] && ok "上级目录带 sticky 位（/tmp 那样）：允许" || fail "rc=${rc}：$out"
chmod 755 "$TMP/c10/open"
# 路径里的符号链接（安装目录本身、上级目录、末尾带斜杠）：解析成物理路径一次、只用它——装进链接指向的真实目录（Codex 补审再复核）
mkdir -p "$TMP/c11/real/bin"; ln -s "$TMP/c11/real" "$TMP/c11/link"
out="$(binstall "$TMP/c11" TODOPI_FORCE_BINARY=1 TODOPI_INSTALL_DIR="$TMP/c11/link/bin/")"; rc=$?
[ "$rc" -eq 0 ] && [ -x "$TMP/c11/real/bin/todopi" ] && [ -L "$TMP/c11/link" ] && ok "路径里有符号链接、末尾带斜杠：解析成物理路径后装进真实目录" || fail "rc=${rc}：$out"
grep -q 'INSTALL_DIR=$(safe_path "$INSTALL_DIR")' install.sh && ok "检查之后只用解析出的物理路径（链接事后改指也改不到写入位置）" || fail "install.sh 没有改用物理路径"
if [ "$(uname -s)" = "Darwin" ]; then
  mkdir -p "$TMP/c12/bin" && chmod +a "everyone allow add_file,delete_child" "$TMP/c12/bin"
  out="$(binstall "$TMP/c12" TODOPI_FORCE_BINARY=1 TODOPI_INSTALL_DIR="$TMP/c12/bin")"; rc=$?
  [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "access control list" && [ ! -e "$TMP/c12/bin/todopi" ] && ok "安装目录带允许他人写的 ACL：拒绝安装" || fail "rc=${rc}：$out"
  mkdir -p "$TMP/c13/up/bin" && chmod +a "everyone allow add_file,delete_child" "$TMP/c13/up"
  out="$(binstall "$TMP/c13" TODOPI_FORCE_BINARY=1 TODOPI_INSTALL_DIR="$TMP/c13/up/bin")"; rc=$?
  [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "c13/up has an access control list" && [ ! -e "$TMP/c13/up/bin/todopi" ] && ok "上级目录带允许他人写的 ACL：拒绝安装" || fail "rc=${rc}：$out"
  mkdir -p "$TMP/c14/home/bin" && chmod +a "group:everyone deny delete" "$TMP/c14/home"
  out="$(binstall "$TMP/c14" TODOPI_FORCE_BINARY=1 TODOPI_INSTALL_DIR="$TMP/c14/home/bin")"; rc=$?
  [ "$rc" -eq 0 ] && ok "只有 deny 条目的 ACL（macOS 家目录默认那条）：允许" || fail "rc=${rc}：$out"
fi

# ACL 读不出来（getfacl 报错）：当作不安全，拒绝（Codex 补审第五轮）。用一个会失败的 getfacl 桩、并让 ls 报告 + 来走到这一支
if [ "$(uname -s)" != "Darwin" ]; then
  FB="$TMP/failacl"; mkdir -p "$FB"
  printf '#!/bin/sh\nexit 1\n' > "$FB/getfacl"; chmod +x "$FB/getfacl"
  printf '#!/bin/sh\n/bin/ls "$@" | sed "1s/^\\([^ ]*\\)/\\1+/"\n' > "$FB/ls"; chmod +x "$FB/ls"
  out="$(PATH="$FB:$PATH" binstall "$TMP/c15" TODOPI_FORCE_BINARY=1)"; rc=$?
  [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "access control list" && ok "ACL 读不出来：拒绝安装（不当成安全）" || fail "rc=${rc}：$out"
fi

# PATH 提示按 shell 给出该写的文件
out="$(binstall "$TMP/c4" TODOPI_FORCE_BINARY=1 SHELL=/bin/zsh)"
printf '%s' "$out" | grep -q ">> ~/.zshrc" && ok "zsh 用户的 PATH 提示写 ~/.zshrc" || fail "$out"
out="$(binstall "$TMP/c7" TODOPI_FORCE_BINARY=1 SHELL=/usr/bin/fish)"
printf '%s' "$out" | grep -q "fish_add_path" && ok "fish 用户的 PATH 提示用 fish_add_path" || fail "$out"

# 钉版本：不存在的版本下载失败；不钉时从 /latest 的 302 解析
out="$(env HOME="$TMP/b7" TODOPI_VERSION=1.2.3 TODOPI_DOWNLOAD_BASE="file://$REL" TODOPI_FORCE_BINARY=1 sh ./install.sh 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "v1.2.3/todopi-1.2.3-" && ok "TODOPI_VERSION 钉版本：按钉的版本取资产" || fail "rc=${rc}：$out"
PORT="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
node -e '
require("http").createServer((q, r) => {
  if (q.url === "/latest") { r.writeHead(302, { location: "/tag/v9.9.9" }); r.end(); }
  else { r.writeHead(200); r.end("release page"); }
}).listen(Number(process.argv[1]), "127.0.0.1");' "$PORT" &
SERVER=$!
disown "$SERVER" 2>/dev/null
sleep 0.5
out="$(env HOME="$TMP/b8" TODOPI_RELEASES_URL="http://127.0.0.1:$PORT" TODOPI_DOWNLOAD_BASE="file://$REL" TODOPI_FORCE_BINARY=1 sh ./install.sh 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$("$TMP/b8/.local/bin/todopi")" = "$FV-fake" ] && ok "不钉版本：从 /releases/latest 的 302 解析出 v${FV}" || fail "rc=${rc}：$out"

[ "$FAILED" -eq 0 ] && { echo "f21-install: pass"; exit 0; } || { echo "f21-install: fail"; exit 1; }
