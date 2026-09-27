#!/bin/sh
# todopi installer.
#
#   curl -fsSL https://raw.githubusercontent.com/seandong/todopi/main/install.sh | sh
#
# With Node.js >= 20 on PATH it installs the npm package (about 460 KB of JavaScript, 2.3 MB with dependencies) into ~/.local.
# Without it, it downloads the self-contained binary for your platform from the GitHub release,
# checks its SHA-256 against the release's SHA256SUMS, and refuses to install on a mismatch.
# Either way the `todopi` command ends up in ~/.local/bin.
#
# Environment:
#   TODOPI_VERSION         install this version (for example 0.2.0) instead of the latest release
#   TODOPI_INSTALL_DIR     where the command goes (default: ~/.local/bin)
#   TODOPI_FORCE_BINARY=1  install the binary even when Node.js >= 20 is available
#   TODOPI_SKIP_CHECKSUM=1 install the binary without verifying it (not recommended; warns)
#   TODOPI_DOWNLOAD_BASE   where release files are fetched from (default: the GitHub releases of
#                          seandong/todopi); a file:// URL works too, which is how the tests run offline
#   TODOPI_NPM_SPEC        what npm installs (default: todopi@<version>); a path to a .tgz works too
#   TODOPI_RELEASES_URL    where `/latest` is resolved (default: the GitHub releases page; for tests)
#
# Safety shape follows rtk's installer (DECISIONS D008, decision 3): the latest version is resolved
# from the /releases/latest redirect rather than the rate-limited API; the checksum is mandatory;
# archive entries are inspected before extraction and absolute or `..` paths are refused (CWE-22).

set -eu

REPO="seandong/todopi"
DEFAULT_BASE="https://github.com/${REPO}/releases"

say() { printf 'todopi-install: %s\n' "$*"; }
die() { printf 'todopi-install: error: %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "this installer needs \`$1\`, which is not on PATH"; }

fetch() { # fetch <url> <output file>
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -qO "$2" "$1"
  else die "this installer needs curl or wget"
  fi
}

latest_version() {
  # The redirect of /releases/latest names the tag: .../releases/tag/v1.2.3
  releases=${TODOPI_RELEASES_URL:-"$DEFAULT_BASE"}
  if command -v curl >/dev/null 2>&1; then
    url=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "${releases}/latest") || die "could not reach ${releases}/latest"
  elif command -v wget >/dev/null 2>&1; then
    # wget follows the redirect; the last Location header it printed is the tag page
    url=$(wget -q -O /dev/null --server-response "${releases}/latest" 2>&1 | awk 'tolower($1) == "location:" { l = $2 } END { print l }' | tr -d '\r')
    [ -n "$url" ] || die "could not reach ${releases}/latest"
  else
    die "this installer needs curl or wget"
  fi
  tag=${url##*/}
  case "$tag" in
    v[0-9]*) printf '%s\n' "${tag#v}" ;;
    *) die "could not work out the latest version from ${url}; set TODOPI_VERSION" ;;
  esac
}

node_ok() { # Node.js >= 20 on PATH?
  command -v node >/dev/null 2>&1 || return 1
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null) || return 1
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -ge 20 ]
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else return 1
  fi
}

# The install dir and every directory above it must be out of other users' reach, or someone else could replace the
# directory or a file in it mid-install. The path is resolved to its physical form first (pwd -P) and only that form is used
# from then on: a symlink anywhere in what the user gave (an attacker-owned link under /tmp, a trailing slash) is followed
# once, checked, and never looked at again. Each level of the physical path must be owned by us or root, not writable by
# group or others unless sticky (others cannot rename or delete our entries there, as in /tmp), and carry no ACL entry that
# lets anyone else write (ACL rights do not show in the mode bits). Deny entries such as macOS's default
# "group:everyone deny delete" on home directories are fine.
acl_lets_others_write() { # dir
  case "$(ls -ld "$1" | awk '{ print $1 }')" in *+) ;; *) return 1 ;; esac
  if [ "$(uname -s)" = "Darwin" ]; then
    ls -led "$1" | awk -v me="user:$(id -un)" 'NR > 1 && $0 ~ / allow / && $0 !~ me " allow" &&
      $0 ~ /add_file|add_subdirectory|delete_child|write|append|delete|chown|writesecurity/ { found = 1 } END { exit !found }'
    return $?
  fi
  command -v getfacl >/dev/null 2>&1 || return 0 # an ACL we cannot read: assume the worst
  # Capture first and check getfacl's own status: piping straight into awk would turn a failed read into "no risky ACL"
  acl=$(getfacl -cp "$1" 2>/dev/null) || return 0
  [ -n "$acl" ] || return 0
  printf '%s\n' "$acl" | awk -F: -v me="$(id -un)" '
    $1 == "mask" { mask = $3 }
    ($1 == "user" && $2 != "" && $2 != me) || ($1 == "group" && $2 != "") { if ($3 ~ /w/) named = 1 }
    END { exit !(named && (mask == "" || mask ~ /w/)) }'
}

safe_path() { # dir -> prints the physical path, or dies
  phys=$(cd "$1" 2>/dev/null && pwd -P) || die "cannot enter ${1}"
  uid=$(id -u)
  d=$phys
  while :; do
    [ -n "$(find "$d" -prune \( -user "$uid" -o -user 0 \) \( \( ! -perm -020 ! -perm -002 \) -o -perm -1000 \) 2>/dev/null)" ] \
      || die "${d} is owned by another user or writable by other users; refusing to install into ${phys} (set TODOPI_INSTALL_DIR to a directory only you control)"
    acl_lets_others_write "$d" && die "${d} has an access control list that lets other users write to it; refusing to install into ${phys}"
    [ "$d" = "/" ] && break
    d=$(dirname "$d")
  done
  [ -n "$(find "$phys" -prune -user "$uid" 2>/dev/null)" ] || die "${phys} must be owned by you; refusing to install into it"
  printf '%s\n' "$phys"
}

platform() {
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) die "no prebuilt binary for $(uname -s); install Node.js >= 20 and run: npm i -g todopi" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) die "no prebuilt binary for $(uname -m); install Node.js >= 20 and run: npm i -g todopi" ;;
  esac
  printf '%s-%s\n' "$os" "$arch"
}

INSTALL_DIR=${TODOPI_INSTALL_DIR:-"$HOME/.local/bin"}
NPM_FAILED=0
BASE=${TODOPI_DOWNLOAD_BASE:-"$DEFAULT_BASE/download"}

if [ -n "${TODOPI_VERSION:-}" ]; then
  VERSION=${TODOPI_VERSION#v}
  case "$VERSION" in *[!0-9A-Za-z.+-]*|'') die "TODOPI_VERSION ${TODOPI_VERSION} is not a version number" ;; esac
else
  VERSION=$(latest_version)
fi

mkdir -p "$INSTALL_DIR" || die "cannot create ${INSTALL_DIR}"

install_npm() { # returns non-zero (and says why) instead of dying: the caller falls back to the binary
  spec=${TODOPI_NPM_SPEC:-"todopi@${VERSION}"}
  # npm puts the command in <prefix>/bin: with prefix ~/.local that is ~/.local/bin
  prefix=$(dirname "$INSTALL_DIR")
  say "Node.js $(node -p 'process.versions.node') found; installing the npm package ${spec} into ${prefix}"
  if ! log=$(npm install --global --prefix "$prefix" "$spec" 2>&1); then
    printf '%s\n' "$log" | tail -5 >&2
    NPM_FAILED=1
    say "WARNING: npm could not install ${spec} (see above); installing the standalone binary instead"
    return 1
  fi
  [ -x "$INSTALL_DIR/todopi" ] || { NPM_FAILED=1; say "npm finished but ${INSTALL_DIR}/todopi is not there; falling back to the binary"; return 1; }
}

install_binary() {
  target=$(platform)
  asset="todopi-${VERSION}-${target}.tar.gz"
  base="${BASE}/v${VERSION}"
  need tar
  work=$(mktemp -d 2>/dev/null || mktemp -d -t todopi)
  new=""
  # 清理在 EXIT 里做；信号（包括关终端的 HUP）转成 exit 1，走同一个清理——不在 ~/.local/bin 留半个临时文件
  trap 'rm -rf "$work"; [ -n "$new" ] && rm -f "$new"' EXIT
  trap 'exit 1' HUP INT TERM
  say "downloading ${asset}"
  fetch "${base}/${asset}" "$work/$asset" || die "could not download ${base}/${asset}"

  if [ "${TODOPI_SKIP_CHECKSUM:-}" = "1" ]; then
    say "WARNING: TODOPI_SKIP_CHECKSUM=1, installing without verifying the download"
  else
    fetch "${base}/SHA256SUMS" "$work/SHA256SUMS" || die "could not download ${base}/SHA256SUMS; refusing to install an unverified binary"
    want=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1; exit }' "$work/SHA256SUMS")
    [ -n "$want" ] || die "SHA256SUMS has no entry for ${asset}; refusing to install"
    got=$(sha256_of "$work/$asset") || die "no sha256sum or shasum to verify the download with; refusing to install (set TODOPI_SKIP_CHECKSUM=1 to override)"
    [ "$got" = "$want" ] || die "checksum mismatch for ${asset} (expected ${want}, got ${got}); refusing to install"
    say "checksum verified"
  fi

  # Inspect every entry before extracting anything: no absolute paths, no `..`, and nothing but the one binary.
  entries=$(tar -tzf "$work/$asset") || die "${asset} is not a readable archive"
  printf '%s\n' "$entries" | while IFS= read -r entry; do
    case "$entry" in
      /*) die "archive entry ${entry} is an absolute path; refusing to extract" ;;
      ..|../*|*/..|*/../*) die "archive entry ${entry} contains ..; refusing to extract" ;;
      todopi|./todopi) ;;
      *) die "unexpected archive entry ${entry}; refusing to extract" ;;
    esac
  done || exit 1

  mkdir "$work/x"
  tar -xzf "$work/$asset" -C "$work/x"
  [ -f "$work/x/todopi" ] && [ ! -L "$work/x/todopi" ] || die "the archive does not contain a regular file named todopi"
  # Copy next to the target first, then run it there, then rename. Running it from the temp dir would fail wherever /tmp is
  # mounted noexec; running it before the rename means a binary that cannot start here (for example on musl-based Linux such
  # as Alpine, which the glibc builds do not support) is never reported as installed; the rename means an interrupted install
  # never leaves half a binary in place.
  # Writing into a directory another user can modify cannot be made race-free with shell tools: they can swap a file we
  # just created for a symlink between two commands, and cp / chmod would follow it to a file elsewhere. The installer is
  # meant to be run by the user who owns the install dir; safe_path refuses anything else, then mktemp is enough.
  INSTALL_DIR=$(safe_path "$INSTALL_DIR") || exit 1
  new=$(mktemp "$INSTALL_DIR/.todopi.new.XXXXXX") || die "could not create a temporary file in ${INSTALL_DIR}"
  cp "$work/x/todopi" "$new" && [ -f "$new" ] && [ ! -L "$new" ] && chmod 755 "$new" \
    || { rm -f "$new"; die "could not write a regular file to ${INSTALL_DIR}"; }
  if ! "$new" --version >/dev/null 2>&1; then
    rm -f "$new"
    if [ "$NPM_FAILED" = "1" ]; then die "the downloaded binary does not run on this system ($(uname -s) $(uname -m)), and the npm package could not be installed either (see above)"
    elif node_ok; then die "the downloaded binary does not run on this system ($(uname -s) $(uname -m)); with Node.js >= 20 available, run: npm i -g todopi"
    else die "the downloaded binary does not run on this system ($(uname -s) $(uname -m)); install Node.js >= 20 and run this installer again"
    fi
  fi
  mv -f "$new" "$INSTALL_DIR/todopi" || { rm -f "$new"; die "could not write ${INSTALL_DIR}/todopi"; }
  # A `tp` left by an earlier npm install still points at the old package: point it at the binary. A `tp` from another tool
  # is left alone.
  if [ -L "$INSTALL_DIR/tp" ]; then
    case "$(readlink "$INSTALL_DIR/tp")" in
      *node_modules/todopi/*) ln -sf todopi "$INSTALL_DIR/tp" && say "pointed ${INSTALL_DIR}/tp at the binary too" ;;
    esac
  fi
}

# The npm path needs Node >= 20, npm, and an install dir named bin (npm puts commands in <prefix>/bin).
if [ "${TODOPI_FORCE_BINARY:-}" != "1" ] && node_ok && command -v npm >/dev/null 2>&1 && [ "$(basename "$INSTALL_DIR")" = "bin" ] \
  && install_npm; then
  :
else
  if [ "${TODOPI_FORCE_BINARY:-}" = "1" ]; then :
  elif ! node_ok; then say "no Node.js >= 20 found"
  elif ! command -v npm >/dev/null 2>&1; then say "Node.js found but npm is not; installing the binary"
  elif [ "$(basename "$INSTALL_DIR")" != "bin" ]; then say "npm installs commands into a directory named bin, and ${INSTALL_DIR} is not one; installing the binary"
  fi
  install_binary
fi

say "installed: $("$INSTALL_DIR/todopi" --version 2>/dev/null || echo "$INSTALL_DIR/todopi") at ${INSTALL_DIR}/todopi"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) say "next: cd into a repository and run \`todopi init\`" ;;
  *)
    say "${INSTALL_DIR} is not on your PATH. Add it, then open a new shell:"
    case "${SHELL:-}" in
      */fish) say "  fish_add_path ${INSTALL_DIR}" ;;
      */zsh) say "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.zshrc" ;;
      */bash) if [ "$(uname -s)" = "Darwin" ]; then say "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.bash_profile"
              else say "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.bashrc"; fi ;;
      *) say "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.profile" ;;
    esac
    ;;
esac
