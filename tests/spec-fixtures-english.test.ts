import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 语料的说明是写给实现者看的，与规格一样 English-first（PRD 本地化一行；F37）。语料**数据**里的中文（title-unicode 的标题）
 * 是测的东西本身，不算。
 */
test("spec/fixtures 的 note / reason / reader_must 里没有中文", () => {
  const CJK = /[　-〿㐀-䶿一-鿿＀-￯]/;
  for (const kind of ["valid", "invalid"]) {
    for (const f of readdirSync(join("spec", "fixtures", kind)).filter((x) => x.endsWith(".json"))) {
      const d = JSON.parse(readFileSync(join("spec", "fixtures", kind, f), "utf8")) as Record<string, unknown>;
      for (const k of ["note", "reason", "reader_must"]) {
        if (typeof d[k] === "string") assert.doesNotMatch(d[k] as string, CJK, `${kind}/${f} ${k}`);
      }
    }
  }
});
