import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// ARCH-002 / ARCH-014 是 .harness/arch-rules.json 里的 grep 管道。它们的「跳过注释行」过滤曾写成 `\\*`——ERE 里
// 那是「零个或多个反斜杠」，匹配空串，于是每一行都被当成注释滤掉，两条规则一直空转（F18 发现）。这里拿规则里
// 存的命令原样去跑：会咬的要咬，不该咬的不咬。

const rules = JSON.parse(readFileSync(join(import.meta.dirname, "../../.harness/arch-rules.json"), "utf8")) as
  { rules?: { id: string; check: string }[] } | { id: string; check: string }[];
const list = Array.isArray(rules) ? rules : rules.rules ?? [];
const check = (id: string) => list.find((r) => r.id === id)!.check;

function run(id: string, files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), "todopi-arch-"));
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(d, p)), { recursive: true });
    writeFileSync(join(d, p), text);
  }
  return execFileSync("bash", ["-c", check(id)], { cwd: d, encoding: "utf8" });
}

test("ARCH-002：board 之外的监听、setInterval 被拦；注释里提到不算；board 里的 listen 必须写明 127.0.0.1", () => {
  assert.match(run("ARCH-002", { "src/commands/x.ts": "setInterval(() => 1, 5);\n" }), /x\.ts:1:/);
  assert.match(run("ARCH-002", { "src/commands/x.ts": "server.listen(80);\n" }), /x\.ts:1:/);
  assert.equal(run("ARCH-002", { "src/commands/x.ts": "// 不用 setInterval\n * setInterval 心跳\n/* createServer */\n" }), "");
  assert.equal(run("ARCH-002", { "src/board/s.ts": "const server = createServer();\nserver.listen(port, \"127.0.0.1\", cb);\nsetInterval(f, 1);\n" }), "");
  assert.match(run("ARCH-002", { "src/board/s.ts": "server.listen(port, cb);\n" }), /s\.ts:1:/);
  assert.match(run("ARCH-002", { "src/board/s.ts": "server.listen(port, \"0.0.0.0\", cb);\n" }), /s\.ts:1:/);
  // 字面量必须是 listen 的第二个参数，同一行别处出现不算（F18 评审）
  assert.match(run("ARCH-002", { "src/board/s.ts": "server.listen(port); // \"127.0.0.1\"\n" }), /s\.ts:1:/);
  assert.match(run("ARCH-002", { "src/board/s.ts": "const h = \"127.0.0.1\"; server.listen(port);\n" }), /s\.ts:1:/);
  assert.match(run("ARCH-002", { "src/board/s.ts": "server.listen(port, host, \"127.0.0.1\");\n" }), /s\.ts:1:/);
});

test("ARCH-014：代码行里的中文被拦；整行注释不算；行尾 // 注释不算", () => {
  assert.match(run("ARCH-014", { "src/commands/x.ts": "throw new Error(\"出错了\");\n" }), /x\.ts:1:/);
  assert.equal(run("ARCH-014", { "src/commands/x.ts": "// 中文注释\n * 中文\n/* 中文 */\nconst a = 1; // 行尾中文\n" }), "");
  assert.match(run("ARCH-014", { "src/commands/x.ts": "f(); /* 行尾块注释 */\n" }), /x\.ts:1:/, "行尾块注释照规则的 fix 移到独立行");
});
