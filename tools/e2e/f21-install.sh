#!/usr/bin/env bash
# tools/e2e/f21-install.sh —— F21 的 Layer 3。
# 1. npm 包：打包（tsc 逐文件编译，不打包）、纯 JS、依赖在白名单内、engines；用 install.sh 的 npm 路径装进一个空 HOME，跑第一条命令。
#    有 docker 时再在 node:20.0.0 的干净容器里 npm i -g 这个包、跑第一条命令（Node ≥ 20 的下限）。
# 2. install.sh 的二进制路径：用一个假的「二进制」（shell 脚本）做发布资产，离线（file://）测选择逻辑、SHA-256 校验、
#    归档条目检查（绝对路径、..、多余条目）、装到 ~/.local/bin、PATH 提示、钉版本、/latest 的 302 解析。
#    真的 Bun 二进制在干净容器里的测试在 .github/workflows/install.yml（有 Node / 无 Node 各一次）。

set -u
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
  [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "\[done\] first" && printf '%s' "$out" | grep -q "^v20.0.0$" \
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
for t in sh curl tar gzip awk cut mktemp uname mkdir chmod mv rm cp dirname basename sha256sum shasum cat env head tr; do
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
for t in sh curl tar gzip awk cut mktemp uname mkdir chmod mv rm cp dirname basename sha256sum shasum cat env head tr node; do
  p="$(command -v "$t" 2>/dev/null)" && ln -sf "$p" "$NN/$t"
done
out="$(PATH="$NN" binstall "$TMP/c1")"; rc=$?
[ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "npm is not" && [ "$("$TMP/c1/.local/bin/todopi")" = "$FV-fake" ] \
  && ok "有 Node 没有 npm：装二进制" || fail "rc=${rc}：$out"
out="$(binstall "$TMP/c2" TODOPI_NPM_SPEC="$TMP/does-not-exist.tgz")"; rc=$?
[ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "falling back to the binary" && [ "$("$TMP/c2/.local/bin/todopi")" = "$FV-fake" ] \
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

# PATH 提示按 shell 给出该写的文件
out="$(binstall "$TMP/c4" TODOPI_FORCE_BINARY=1 SHELL=/bin/zsh)"
printf '%s' "$out" | grep -q ">> ~/.zshrc" && ok "zsh 用户的 PATH 提示写 ~/.zshrc" || fail "$out"

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
