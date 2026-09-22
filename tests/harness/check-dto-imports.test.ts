import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

/**
 * ARCH-020 检查器的正反例。
 *
 * 架构规则本身也是代码。到写这个文件为止，ARCH-001/002/011/013 都曾误伤真实
 * 代码或从来没生效过，ARCH-020 的扫描器被 Codex 连续三轮挑出漏检——
 * 而它们没有一条有测试。检查器的价值全在「该响的时候响、不该响的时候不响」，
 * 这正是可以用例钉死的东西。
 */
function run(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "todopi-arch020-"));
  for (const [name, body] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return execFileSync(process.execPath, ["--no-warnings", "tools/check-dto-imports.mjs", root], {
    encoding: "utf8", cwd: process.cwd(),
  });
}
const flags = (files: Record<string, string>): boolean => run(files).trim() !== "";

test("值导入被抓到", () => {
  assert.ok(flags({ "a.ts": 'import { isReady } from "../../domain/derive.ts";\n' }));
});

test("import type 不报 —— 类型不含行为，剥离后整条语句消失", () => {
  assert.ok(!flags({ "a.ts": 'import type { T } from "../../domain/types.ts";\n' }));
});

test("内联的 { type A } 要报 —— 类型没了，运行时依赖还在", () => {
  // 剥离之后它变成 `import { } from "../../domain/derive.ts"`，模块照样被加载。
  // 规则守的不变量是「剥离类型之后 dto 对 domain 的运行时依赖为零」，
  // 所以这种写法要被推到 import type 上去，改法也就一个词的事。
  assert.ok(flags({ "a.ts": 'import { type A, type B } from "../../domain/derive.ts";\n' }));
});

test("只为副作用的裸 import 同样要报", () => {
  assert.ok(flags({ "a.ts": 'import "../../domain/derive.ts";\n' }));
});

test("跨多行的 import 两种都判对", () => {
  assert.ok(!flags({ "a.ts": 'import type {\n  A,\n  B,\n} from "../../domain/derive.ts";\n' }));
  assert.ok(flags({ "a.ts": 'import {\n  isReady,\n  type T,\n} from "../../domain/derive.ts";\n' }));
});

test("re-export 也是值导入", () => {
  assert.ok(flags({ "a.ts": 'export { isReady } from "../../domain/derive.ts";\n' }));
  assert.ok(!flags({ "a.ts": 'export type { T } from "../../domain/types.ts";\n' }));
});

test("动态 import 一律算值导入，模板串也算", () => {
  assert.ok(flags({ "a.ts": 'const d = await import("../../domain/derive.ts");\n' }));
  assert.ok(flags({ "a.ts": "const d = await import(`../../domain/derive.ts`);\n" }));
});

test("子目录与 .mts / .cts / .tsx 都被扫到", () => {
  assert.ok(flags({ "sub/deep/a.mts": 'import { x } from "../../../domain/derive.ts";\n' }));
  assert.ok(flags({ "a.cts": 'import { x } from "../domain/derive.ts";\n' }));
  assert.ok(flags({ "a.tsx": 'import { x } from "../domain/derive.ts";\n' }));
});

test("同一行上的第二条 import 不会被漏掉", () => {
  assert.ok(flags({
    "a.ts": 'import type { T } from "../../domain/types.ts"; import { isReady } from "../../domain/derive.ts";\n',
  }));
});

test("注释里的 import 不误报", () => {
  assert.ok(!flags({ "a.ts": '// import { isReady } from "../../domain/derive.ts";\n' }));
  assert.ok(!flags({ "a.ts": '/* import { isReady } from "../../domain/derive.ts"; */\n' }));
  assert.ok(!flags({ "a.ts": 'const x = 1; // await import("../../domain/derive.ts")\n' }));
});

test("字符串里的 /* 不会吞掉后面真正的 import", () => {
  // 先前用正则删注释，这里的 "/*" 会让它一路吞到下一个 "*/"，
  // 把中间真正的 import 一起吃掉——漏检比误报危险（Codex 第三轮评审）。
  assert.ok(flags({
    "a.ts": 'const s = "/*";\nimport { isReady } from "../../domain/derive.ts";\nconst e = "*/";\n',
  }));
});

test("正则字面量里的引号不会扰乱引号状态", () => {
  // const re = /["']/ 里的引号若被当成字符串开头，后面的 import 会被整个吞掉
  // （Codex 第四轮评审）。
  assert.ok(flags({
    "a.ts": 'const re = /["\']/;\nimport { isReady } from "../../domain/derive.ts";\n',
  }));
});

test("非 ASCII 字符不会让位置错位", () => {
  // 先前用 Array.from 建输出数组（按码点拆），却按码元遍历，
  // 一个 emoji 就能让两者错位，后面的 import 漏检（Codex 第四轮评审）。
  assert.ok(flags({
    "a.ts": 'const s = "🚀🚀🚀"; // 说明\nimport { isReady } from "../../domain/derive.ts";\n',
  }));
  assert.ok(!flags({
    "a.ts": 'const s = "🚀🚀🚀"; // 说明\nimport type { T } from "../../domain/types.ts";\n',
  }));
});

test("反斜杠转义与 import.meta 不误判", () => {
  assert.ok(!flags({ "a.ts": 'const s = "a\\\\"; const u = import.meta.dirname;\n' }));
});

test("不指向 domain/ 的导入一概不报", () => {
  assert.ok(!flags({ "a.ts": 'import { readFileSync } from "node:fs";\nimport { x } from "../render/ls.ts";\n' }));
});

test("解析不了的文件被明确报出来，而不是静默通过", () => {
  const out = run({ "a.ts": "this is ( not valid typescript {{{\n" });
  assert.match(out, /cannot be checked/, "解析失败时必须出声——静默通过等于这条规则没跑");
});
