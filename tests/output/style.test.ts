import { test } from "node:test";
import assert from "node:assert";
import { ANSI, MONO, PLAIN, chooseStyle, type StyleFacts } from "../../src/output/style.ts";

/** 上色的判定只有这一处（tp-rk6o8q）：进模型上下文的输出不能有转义（ARCH-027）。 */
const base: StyleFacts = { json: false, hook: false, agent: false, env: {}, isTTY: true };
const pick = (f: Partial<StyleFacts>) => chooseStyle({ ...base, ...f });

test("人在终端里：上色；不是终端：纯文本", () => {
  assert.equal(pick({}), ANSI);
  assert.equal(pick({ isTTY: false }), PLAIN);
});

test("--json、钩子、有 agent 在场：纯文本，FORCE_COLOR 也不越过", () => {
  for (const f of [{ json: true }, { hook: true }, { agent: true }]) {
    assert.equal(pick(f), PLAIN, JSON.stringify(f));
    assert.equal(pick({ ...f, env: { FORCE_COLOR: "1" } }), PLAIN, `${JSON.stringify(f)} + FORCE_COLOR`);
  }
});

test("NO_COLOR（空值也算）、TERM=dumb：终端里去掉颜色但仍是给人看的排版（MONO），管道里是 PLAIN；FORCE_COLOR 也不带回颜色", () => {
  assert.equal(pick({ env: { NO_COLOR: "" } }), MONO);
  assert.equal(pick({ env: { NO_COLOR: "1", FORCE_COLOR: "1" } }), MONO);
  assert.equal(pick({ env: { TERM: "dumb" } }), MONO);
  assert.equal(pick({ isTTY: false, env: { NO_COLOR: "1", FORCE_COLOR: "1" } }), PLAIN);
  assert.equal(MONO.green("x"), "x");
  assert.equal(MONO.interactive, true);
  assert.equal(PLAIN.interactive, false);
});

test("FORCE_COLOR 只越过 isTTY；0 或空值不算", () => {
  assert.equal(pick({ isTTY: false, env: { FORCE_COLOR: "1" } }), ANSI);
  assert.equal(pick({ isTTY: false, env: { FORCE_COLOR: "0" } }), PLAIN);
  assert.equal(pick({ isTTY: false, env: { FORCE_COLOR: "" } }), PLAIN);
});

test("PLAIN 原样返回，ANSI 包上转义并复位", () => {
  assert.equal(PLAIN.green("x"), "x");
  assert.match(ANSI.green("x"), /^\x1b\[32mx\x1b\[39m$/);
  assert.equal(ANSI.bold(""), "");
});
