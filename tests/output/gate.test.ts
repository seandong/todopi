import { test } from "node:test";
import assert from "node:assert";
import { renderGateReport, renderGateJson, renderTransition } from "../../src/output/render/gate.ts";
import type { GateReport } from "../../src/output/dto/gate.ts";
import type { Refusal } from "../../src/domain/gates.ts";

const report = (refused: Refusal[], code = 2): GateReport => ({
  id: "tp-000001", title: "Add passkey sign-in", transition: "done", refused, code,
});

const acceptance: Refusal = {
  gate: "acceptance", code: 2,
  unchecked: [
    { n: 1, text: "Existing passkey users can sign in", checked: false, line: 2 },
    { n: 3, text: "Three failures fall back to password", checked: false, line: 4 },
  ],
};
const children: Refusal = {
  gate: "children", code: 2,
  open: [
    { id: "tp-000002", title: "Wire the WebAuthn ceremony", status: "in_progress" },
    { id: "tp-000003", title: "Migrate existing sessions", status: "open" },
  ],
};
const ownership: Refusal = {
  gate: "ownership", code: 3, holder: "codex@mbp", heldSince: "2026-09-14T11:00:00Z",
};

test("未勾的标准逐条列出，带序号与原文", () => {
  const out = renderGateReport(report([acceptance]));
  assert.match(out, /1\. Existing passkey users can sign in/);
  assert.match(out, /3\. Three failures fall back to password/);
});

test("未关闭的子任务带 id、标题与状态", () => {
  const out = renderGateReport(report([children]));
  for (const s of ["tp-000002", "Wire the WebAuthn ceremony", "in_progress",
                   "tp-000003", "Migrate existing sessions", "open"]) {
    assert.ok(out.includes(s), `报告里缺少 ${s}`);
  }
});

test("归属冲突带持有者与其最近一次写入时间", () => {
  const out = renderGateReport(report([ownership], 3));
  assert.match(out, /codex@mbp/);
  assert.match(out, /2026-09-14T11:00:00Z/);
});

test("报告独立回答三个问题：哪道门、具体是什么、下一步", () => {
  // FR-D2a：不需要再跑别的命令就能据以行动。
  const out = renderGateReport(report([children]));
  assert.match(out, /Child tasks/i, "哪道门");
  assert.match(out, /tp-000002/, "具体是什么");
  assert.match(out, /todopi done tp-000001/, "出路一：修完重跑");
  assert.match(out, /--force --reason/, "出路二：强制");
});

test("多道门禁一起报，不是只报第一条", () => {
  // agent 该一次把活修完，而不是修一条重跑一次再看到下一条。
  const out = renderGateReport(report([ownership, acceptance, children], 3));
  assert.match(out, /codex@mbp/);
  assert.match(out, /Existing passkey users/);
  assert.match(out, /Wire the WebAuthn ceremony/);
});

test("每道门禁都给出自己的下一步动作，不只有结尾那两条", () => {
  assert.match(renderGateReport(report([acceptance])), /todopi check/);
  assert.match(renderGateReport(report([children])), /Close each child/i);
  assert.match(renderGateReport(report([ownership], 3)), /claim --steal/);
});

test("state 门禁说清楚当前状态与要做的迁移", () => {
  const out = renderGateReport(report([{ gate: "state", code: 2, status: "closed", transition: "done" }]));
  assert.match(out, /closed/);
  assert.match(out, /done/);
});

test("出路里的命令用的是实际的迁移名，不是写死的 done", () => {
  const out = renderGateReport({ ...report([children]), transition: "close" });
  assert.match(out, /todopi close tp-000001/);
  assert.doesNotMatch(out, /todopi done/);
});

test("输出是英文", () => {
  for (const rs of [[acceptance], [children], [ownership], [acceptance, children, ownership]]) {
    assert.doesNotMatch(renderGateReport(report(rs)), /[一-鿿]/, "CLI 输出 MUST 是英文");
  }
});

test("--json 可解析，带上全部拒绝与退出码", () => {
  const parsed = JSON.parse(renderGateJson(report([ownership, acceptance], 3))) as Record<string, unknown>;
  for (const k of ["id", "title", "transition", "refused", "code"]) {
    assert.ok(k in parsed, `--json 缺少字段 ${k}`);
  }
  assert.equal(parsed["code"], 3);
  assert.equal((parsed["refused"] as unknown[]).length, 2);
});

test("成功的迁移给一行确认；强制时说明已记为未验证", () => {
  const ok = renderTransition({ id: "tp-000001", title: "T", status: "closed", resolution: "done", forced: false });
  assert.match(ok, /tp-000001/);
  assert.doesNotMatch(ok, /unverified/);
  const forced = renderTransition({ id: "tp-000001", title: "T", status: "closed", resolution: "done", forced: true });
  assert.match(forced, /unverified/i);
  assert.doesNotMatch(renderTransition({ id: "tp-000001", title: "T", status: "closed", forced: true }, { quiet: true }),
    /unverified/i, "--quiet 下只留结果");
});
