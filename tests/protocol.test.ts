import { test } from "node:test";
import assert from "node:assert";
import { PROTOCOL_TEXT, PROTOCOL_BEGIN, PROTOCOL_END, protocolSection } from "../src/protocol.ts";

test("在 800 token 预算内（英文下用字符数 ÷ 4 近似，实测误差 4%）", () => {
  const estimated = Math.ceil(PROTOCOL_TEXT.length / 4);
  assert.ok(estimated <= 800, `估算 ${estimated} token，超出 800 预算`);
});

test("覆盖 PRD §9 的七项大纲", () => {
  const required: Array<[string, RegExp]> = [
    ["todopi 是什么 / 别手改", /never edit those files by hand/i],
    ["粒度", /one change worth a commit/i],
    ["时刻：claim", /todopi claim/],
    ["时刻：add --from", /todopi add .*--from/],
    ["时刻：note", /todopi note/],
    ["时刻：done", /todopi done/],
    ["时刻：handoff", /todopi handoff/],
    ["压缩后主动跑 prime", /compacted/i],
    ["原生 todo 不要复制", /never copy todopi tasks into it/i],
    ["查询", /todopi ls --ready/],
    ["提交", /same commit as the work/i],
  ];
  for (const [name, re] of required) {
    assert.match(PROTOCOL_TEXT, re, `协议文本缺少「${name}」`);
  }
});

test("是英文：不含 CJK 字符", () => {
  assert.doesNotMatch(PROTOCOL_TEXT, /[一-鿿]/, "协议文本是用户可见文案，MUST 是英文");
});

test("protocolSection 用标记包住正文，便于原地替换", () => {
  const s = protocolSection();
  assert.ok(s.startsWith(PROTOCOL_BEGIN));
  assert.ok(s.trimEnd().endsWith(PROTOCOL_END));
  assert.ok(s.includes(PROTOCOL_TEXT));
});

test("标记是 Markdown 注释，渲染时不可见", () => {
  assert.match(PROTOCOL_BEGIN, /^<!--.*-->$/);
  assert.match(PROTOCOL_END, /^<!--.*-->$/);
});
