import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 工作流里交给 npm 的本地包路径必须以 ./ 或 / 开头：`out/todopi-0.1.0.tgz` 这种「名字/名字」会被 npm 当成 GitHub 简写，
 * 去 ssh 拉 github.com/out/todopi-0.1.0.tgz——v0.1.0 首发的 Release 就这样失败在 npm publish（tp-ornltg）。
 */
test("工作流里 npm publish / install 的 .tgz 路径不是「名字/名字」形式", () => {
  const dir = join(process.cwd(), ".github", "workflows");
  const bad: string[] = [];
  for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
    for (const [i, line] of readFileSync(join(dir, f), "utf8").split("\n").entries()) {
      const m = /\bnpm (?:publish|install|i)\b(.*)/.exec(line);
      if (m === null) continue;
      for (const arg of m[1]!.trim().split(/\s+/)) {
        if (/\.tgz$/.test(arg) && !/^(\.{1,2}\/|\/|\$)/.test(arg)) bad.push(`${f}:${i + 1}: ${arg}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
