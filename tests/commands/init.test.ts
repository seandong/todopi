import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { EXIT } from "../../src/exit.ts";
import { PROTOCOL_BEGIN } from "../../src/protocol.ts";

const dir = () => mkdtempSync(join(tmpdir(), "todopi-cmd-init-"));
const count = (s: string, sub: string) => s.split(sub).length - 1;

test("在当前目录创建账本与 AGENTS.md", () => {
  const d = dir();
  const r = runInit({ directory: d, prefix: "tp" });
  assert.ok(existsSync(join(d, ".todopi", "config.yml")));
  assert.ok(readFileSync(join(d, "AGENTS.md"), "utf8").includes(PROTOCOL_BEGIN));
  assert.equal(r.root, d);
});

test("在 git 仓库的子目录里跑，账本建在仓库根（spec §1.1）", () => {
  const d = dir();
  mkdirSync(join(d, ".git"));
  mkdirSync(join(d, "packages", "web"), { recursive: true });
  runInit({ directory: join(d, "packages", "web"), prefix: "tp" });
  assert.ok(existsSync(join(d, ".todopi")), "应当建在仓库根");
  assert.ok(!existsSync(join(d, "packages", "web", ".todopi")), "不应建在子目录");
});

test("重复运行幂等：AGENTS.md 里协议段落仍只有一份", () => {
  const d = dir();
  runInit({ directory: d, prefix: "tp" });
  runInit({ directory: d, prefix: "tp" });
  assert.equal(count(readFileSync(join(d, "AGENTS.md"), "utf8"), PROTOCOL_BEGIN), 1);
});

test("MUST NOT 碰 CLAUDE.md（FR-Q5）", () => {
  const d = dir();
  runInit({ directory: d, prefix: "tp" });
  assert.ok(!existsSync(join(d, "CLAUDE.md")));
});

test("已有的 CLAUDE.md 不被改动", () => {
  const d = dir();
  writeFileSync(join(d, "CLAUDE.md"), "我的内容\n");
  runInit({ directory: d, prefix: "tp" });
  assert.equal(readFileSync(join(d, "CLAUDE.md"), "utf8"), "我的内容\n");
});

test("非法 prefix 抛出退出码 1", () => {
  for (const bad of ["TP", "1tp", "toolongprefix", "", "tp-x"]) {
    assert.throws(
      () => runInit({ directory: dir(), prefix: bad }),
      (e: any) => e.code === EXIT.usage,
      `prefix ${JSON.stringify(bad)} 应当被拒绝`,
    );
  }
});

test("被拒绝的 init 不留下任何副作用", () => {
  const d = dir();
  try { runInit({ directory: d, prefix: "TP" }); } catch { /* 预期 */ }
  assert.ok(!existsSync(join(d, ".todopi")), "校验必须在建目录之前");
  assert.ok(!existsSync(join(d, "AGENTS.md")));
});

test("合法 prefix 被接受并写进 config.yml", () => {
  const d = dir();
  runInit({ directory: d, prefix: "xy9" });
  assert.match(readFileSync(join(d, ".todopi", "config.yml"), "utf8"), /^id_prefix: xy9$/m);
});
