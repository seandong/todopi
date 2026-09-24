import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// 检查器会在本进程注册加载器钩子，所以每种写法放在独立的子进程里跑，互不污染。
const tool = join(import.meta.dirname, "../../tools/check-leaf-imports.mjs");
function problems(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "leaf-"));
  writeFileSync(join(dir, "m.ts"), source);
  return execFileSync(process.execPath, [tool, dir], { encoding: "utf8", cwd: join(import.meta.dirname, "../..") });
}

test("commonmark 允许，类型导入也允许", () => {
  assert.equal(problems('import { Parser } from "commonmark";\nimport type { X } from "node:fs";\nexport const p = Parser;\n'), "");
});

test("评审给过的所有静态写法都被运行时认出来", () => {
  for (const src of [
    '   import { join } from "node:path";\nexport const j = join;',
    'export { join } from "node:path";',
    'import{join}from"node:path"\nexport const j = join;',
    'import /* c */ { join } /* c */ from /* c */ "node:path";\nexport const j = join;',
    'import "node:path";',
  ]) assert.match(problems(src), /node:path/, `没认出来：${src}`);
});

test("动态导入与 require：出现就报", () => {
  assert.match(problems('export const f = () => import("node:fs");'), /动态/);
  assert.match(problems('export const f = () => require("node:fs");'), /动态/);
});
