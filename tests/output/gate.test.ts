import { test } from "node:test";
import assert from "node:assert";
import { renderGateReport, renderGateJson, renderTransition, gateActions } from "../../src/output/render/gate.ts";
import type { GateReport } from "../../src/output/dto/gate.ts";
import type { Refusal } from "../../src/domain/gates.ts";

const report = (refused: Refusal[], code = 2, transition: GateReport["transition"] = "done"): GateReport => {
  const base = { id: "tp-000001", title: "Add passkey sign-in", transition, refused, code };
  return { ...base, actions: gateActions(base) };
};

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
  assert.match(renderGateReport(report([acceptance])), /- \[x\]/, "指出怎么勾");
  assert.match(renderGateReport(report([children])), /A parent closes when its children do/i);
  assert.match(renderGateReport(report([ownership], 3)), /claim tp-000001 --steal/);
});

test("state 门禁说清楚当前状态与要做的迁移", () => {
  const out = renderGateReport(report([{ gate: "state", code: 2, status: "closed", transition: "done" }]));
  assert.match(out, /closed/);
  assert.match(out, /done/);
});

test("出路里的命令用的是实际的迁移名，不是写死的 done", () => {
  const out = renderGateReport(report([ownership], 3, "close"));
  assert.match(out, /todopi close tp-000001/);
});

// ---- 报告给出的命令必须**真的能跑**（Codex 评审 F06 的阻塞项 3）----

test("close 的重试命令带上必填的 --resolution", () => {
  // 第一版写的是 `todopi close <id> again`，粘过去就退出 1——close 必须带
  // --resolution。一条跑不通的命令连「据以行动」的门都没进。
  const out = renderGateReport(report([children], 2, "close"));
  assert.match(out, /todopi close tp-000001 --resolution/);
  assert.doesNotMatch(out, /todopi close tp-000001 again/);
});

test("接管的命令带上 id", () => {
  // 第一版写的是 `todopi claim --steal`，没有 id，跑不了。
  const out = renderGateReport(report([ownership], 3));
  assert.match(out, /todopi claim tp-000001 --steal/);
});

test("验收标准那道门给的是**现在就能做**的动作", () => {
  // `todopi check` 要到 F09 才有，现在建议它等于让 agent 去撞 unknown command。
  const out = renderGateReport(report([acceptance]));
  assert.doesNotMatch(out, /todopi check /, "check 还不存在，不能建议它");
  assert.match(out, /\.todopi\/tasks\/tp-000001\.md/, "要指出改哪个文件");
  assert.match(out, /todopi close tp-000001 --resolution wontfix/, "并给出「不做了」的正当出口");
});

test("reopen 不建议 --force —— 它根本不接受这个选项", () => {
  const out = renderGateReport(report([{ gate: "state", code: 2, status: "open", transition: "reopen" }],
    2, "reopen"));
  assert.doesNotMatch(out, /--force/, "reopen 没有 --force");
});

test("撞上状态门禁时不建议强制 —— --force 越不过状态机（spec §6.1）", () => {
  const out = renderGateReport(report([{ gate: "state", code: 2, status: "closed", transition: "done" }]));
  assert.doesNotMatch(out, /Override with/, "不该给出强制的出路");
  assert.match(out, /--force does not override/i, "而且要明说它越不过去");
});

test("--json 带上可直接执行的动作，不只是拒绝的事实", () => {
  // 解析 JSON 的 agent 拿不到人类那份文本里的命令。
  const parsed = JSON.parse(renderGateJson(report([ownership, children], 3))) as
    { actions: Array<{ for: string; command?: string; detail: string }> };
  assert.ok(Array.isArray(parsed.actions) && parsed.actions.length > 0, "--json 必须带 actions");
  assert.ok(parsed.actions.some((a) => a.command === "todopi claim tp-000001 --steal"));
  assert.ok(parsed.actions.some((a) => a.command === "todopi done tp-000002"));
  assert.ok(parsed.actions.some((a) => a.for === "retry"));
  for (const a of parsed.actions) {
    assert.ok(a.detail.length > 0, `动作 ${a.for} 缺少说明`);
    if (a.command !== undefined) {
      assert.match(a.command, /^todopi /, `动作 ${a.for} 的命令不是完整命令行`);
    }
  }
});

test("文本与 --json 给出的是同一批命令", () => {
  // 分头写的话，迟早只有一边被修。
  const r = report([ownership, acceptance, children], 3);
  const text = renderGateReport(r);
  for (const a of r.actions) {
    if (a.command !== undefined && !a.command.includes("<")) {
      assert.ok(text.includes(a.command), `文本报告里缺少命令：${a.command}`);
    }
  }
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
