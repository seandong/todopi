import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Homebrew formula 生成器（F34）：四个平台各自的地址与 sha256 都来自 SHA256SUMS；缺平台、版本号不对就失败；产物是合法的 Ruby。
 * 真正用 brew 装的实测记在 D054（本机 Command Line Tools 过旧，brew 在安装前拒绝；下载与校验、style 检查通过）。
 */
const hex = (c: string) => c.repeat(64);
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
function sums(lines: string[]): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-brew-"));
  writeFileSync(join(d, "SHA256SUMS"), `${lines.join("\n")}\n`);
  return join(d, "SHA256SUMS");
}
const gen = (...args: string[]) => spawnSync(process.execPath, ["tools/brew/formula.mjs", ...args], { encoding: "utf8" });
const ALL = PLATFORMS.map((p, i) => `${hex("abcd"[i]!)}  todopi-1.2.3-${p}.tar.gz`);

test("每个平台的 url 与 sha256 取自 SHA256SUMS；装 todopi 并链出 tp；test 块核对版本", () => {
  const r = gen("1.2.3", sums(ALL));
  assert.equal(r.status, 0, r.stderr);
  const rb = r.stdout;
  PLATFORMS.forEach((p, i) => {
    const at = rb.indexOf(`/v1.2.3/todopi-1.2.3-${p}.tar.gz"`);
    assert.ok(at > 0, p);
    assert.equal(rb.slice(at).match(/sha256 "([0-9a-f]{64})"/)?.[1], hex("abcd"[i]!), `${p} 的 sha256 紧跟它的 url`);
  });
  assert.match(rb, /on_macos do\s+on_arm do\s+url "[^"]+darwin-arm64/);
  assert.match(rb, /on_linux do\s+on_arm do\s+url "[^"]+linux-arm64/);
  assert.match(rb, /bin\.install "todopi"/);
  assert.match(rb, /bin\.install_symlink "todopi" => "tp"/);
  assert.match(rb, /assert_equal "1\.2\.3", shell_output\("#\{bin\}\/todopi --version"\)\.strip/);
  assert.match(gen("1.2.3", sums(ALL), "file:///tmp/x/").stdout, /url "file:\/\/\/tmp\/x\/todopi-1\.2\.3-linux-x64\.tar\.gz"/);
});

test("缺一个平台、版本号不像版本号：失败，不生成", () => {
  const miss = gen("1.2.3", sums(ALL.slice(0, 3)));
  assert.notEqual(miss.status, 0);
  assert.match(miss.stderr, /no checksum for todopi-1\.2\.3-linux-x64\.tar\.gz/);
  assert.equal(miss.stdout, "");
  const dup = gen("1.2.3", sums([...ALL, `${hex("e")}  todopi-1.2.3-darwin-arm64.tar.gz`]));
  assert.notEqual(dup.status, 0);
  assert.match(dup.stderr, /lists todopi-1\.2\.3-darwin-arm64\.tar\.gz twice with different checksums/);
  assert.equal(gen("1.2.3", sums([...ALL, ALL[0]!])).status, 0, "一模一样的重复无害");
  assert.notEqual(gen("v1.2.3", sums(ALL)).status, 0);
  assert.notEqual(gen("1.2.3; rm -rf /", sums(ALL)).status, 0);
});

test("产物是合法的 Ruby（有 ruby 时）", { skip: spawnSync("ruby", ["-v"]).status !== 0 ? "no ruby" : false }, () => {
  const d = mkdtempSync(join(tmpdir(), "todopi-brew-rb-"));
  writeFileSync(join(d, "todopi.rb"), gen("1.2.3", sums(ALL)).stdout);
  const r = spawnSync("ruby", ["-c", join(d, "todopi.rb")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});
