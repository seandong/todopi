import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { discoverLedger } from "../../src/format/discover.ts";
import { claimHookInjection } from "../../src/format/session.ts";
import { firstInjection } from "../../src/commands/hook.ts";

/** F38：同一会话 10 秒内只注入一次；别的会话、窗口之外、没有会话 id、版本更高的账本照常注入。 */
function ledger() {
  const d = mkdtempSync(join(tmpdir(), "todopi-dedupe-"));
  execFileSync("git", ["init", "-q"], { cwd: d });
  runInit({ directory: d, prefix: "tp" });
  return { d, l: discoverLedger(d) };
}

test("同一会话：第一次 true，窗口内 false，窗口外又 true；别的会话互不影响", () => {
  const { l } = ledger();
  const t0 = 1_800_000_000_000;
  assert.equal(claimHookInjection(l, "s1", t0), true);
  assert.equal(claimHookInjection(l, "s1", t0 + 9_999), false);
  assert.equal(claimHookInjection(l, "s2", t0 + 1), true, "别的会话");
  assert.equal(claimHookInjection(l, "s1", t0 + 10_000), true, "窗口之外（resume、压缩后）");
  assert.equal(claimHookInjection(l, "s1", t0 + 10_001), false, "刚才那次重新开了窗口");
  // 记录比自己的 now 还新一点：并发时等锁的那一方就是这样（now 在拿锁前取）——算重复
  assert.equal(claimHookInjection(l, "s3", t0 + 5_000), true);
  assert.equal(claimHookInjection(l, "s3", t0 + 4_000), false);
  // 差得比窗口还大（时钟大幅回拨）：放行
  assert.equal(claimHookInjection(l, "s4", t0 + 50_000), true);
  assert.equal(claimHookInjection(l, "s4", t0), true);
});

test("没有会话 id 不去重；版本更高的账本不写会话状态、照常注入", () => {
  const { d, l } = ledger();
  assert.equal(firstInjection(d, undefined), true);
  assert.equal(firstInjection(d, undefined), true);
  const cfg = join(d, ".todopi", "config.yml");
  writeFileSync(cfg, readFileSync(cfg, "utf8").replace(/^version: 1$/m, "version: 2"));
  assert.equal(claimHookInjection(l, "v2", 1), true);
  assert.equal(claimHookInjection(l, "v2", 2), true, "不去重，也不写");
});
