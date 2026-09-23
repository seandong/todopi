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

test("文本里出现的命令，恰好就是 actions 里的那些 —— 两边不能各有各的", () => {
  // 第一版这条只检查「JSON 的命令出现在文本里」，是单向的：文本多写一条、
  // 两边 detail 分叉、甚至文本压根不调用 gateActions，它都不会红
  // （Codex 第二轮评审指出）。现在两边取集合比。
  for (const [rs, code, transition] of [
    [[ownership, acceptance, children], 3, "done"],
    [[children], 2, "close"],
    [[ownership], 3, "reopen"],
    [[{ gate: "state", code: 2, status: "closed", transition: "done" } as Refusal], 2, "done"],
  ] as const) {
    const r = report([...rs], code, transition);
    const text = renderGateReport(r);

    const fromActions = new Set(
      r.actions.flatMap((a) => [a.command, a.template]).filter((c): c is string => c !== undefined));
    // 文本里所有形如 `todopi …` 的整行，就是它给出的命令
    const inText = new Set(
      text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("todopi ")),
    );
    assert.deepEqual([...inText].sort(), [...fromActions].sort(),
      `${transition} 的文本与 actions 给出的命令集合必须一致`);

    // detail 也必须来自 actions，不能是文本那边另写的句子
    for (const a of r.actions) {
      assert.ok(text.includes(a.detail), `文本里缺少动作说明：${a.detail}`);
    }
  }
});

test("reopen 遇归属冲突时不给 claim --steal —— 那条命令对 closed 任务必然失败", () => {
  // claim 明确拒绝 closed 任务（退出 2），而 reopen 的对象按定义是 closed。
  // 给一条注定失败的命令比不给更糟：agent 会照着跑然后卡住（Codex 第二轮评审）。
  const r = report([ownership], 3, "reopen");
  const text = renderGateReport(r);
  assert.doesNotMatch(text, /claim .* --steal/, "不该建议 claim --steal");
  assert.ok(r.actions.every((a) => a.command === undefined || !a.command.includes("--steal")),
    "--json 里也不该有");
  assert.match(text, /codex@mbp/, "但要说清是谁持有");
  assert.match(text, /expire|release/i, "并给出真正可行的出路");
});

test("done / close 遇归属冲突时仍然给 claim --steal", () => {
  for (const transition of ["done", "close"] as const) {
    assert.match(renderGateReport(report([ownership], 3, transition)), /todopi claim tp-000001 --steal/);
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

// ---- command 必须真的可直接执行（Codex 第三轮评审的阻塞项）----

test("command 里不得含占位符 —— 带 `<…>` 的要放在 template", () => {
  // 第一版把 `todopi close <id> --resolution <wontfix|duplicate|obsolete>` 放进了
  // command，而 DTO 说它「可直接执行」。字面执行会被 shell 的 `<` 当成重定向，
  // 报 parse error。更糟的是我为此写的 e2e **主动过滤掉了含 `<` 的项**，
  // 于是「每条命令都能跑」那句断言是假绿。
  const cases: Array<[Refusal[], number, GateReport["transition"]]> = [
    [[acceptance], 2, "done"],
    [[children], 2, "close"],
    [[ownership], 3, "done"],
    [[ownership], 3, "reopen"],
    [[{ gate: "state", code: 2, status: "closed", transition: "done" }], 2, "done"],
  ];
  for (const [rs, code, transition] of cases) {
    for (const a of report(rs, code, transition).actions) {
      if (a.command !== undefined) {
        assert.doesNotMatch(a.command, /[<>]/, `${transition}/${a.for} 的 command 含占位符：${a.command}`);
      }
      assert.ok(a.command === undefined || a.template === undefined,
        `${transition}/${a.for} 不能同时给 command 与 template`);
    }
  }
});

test("close 的重跑是 template —— 选哪个 resolution 该由使用者决定", () => {
  const retry = report([children], 2, "close").actions.find((a) => a.for === "retry");
  assert.equal(retry?.command, undefined);
  assert.match(retry?.template ?? "", /--resolution <wontfix\|duplicate\|obsolete>/);
});

test("强制永远是 template —— --reason 的内容只有使用者写得出来", () => {
  for (const transition of ["done", "close"] as const) {
    const force = report([children], 2, transition).actions.find((a) => a.for === "force");
    assert.equal(force?.command, undefined, `${transition} 的强制不该是 command`);
    assert.match(force?.template ?? "", /--force --reason "<why>"/);
  }
});

test("done / reopen 的重跑是完整命令，不是模板", () => {
  for (const transition of ["done", "reopen"] as const) {
    const retry = report([ownership], 3, transition).actions.find((a) => a.for === "retry");
    assert.equal(retry?.template, undefined);
    assert.equal(retry?.command, `todopi ${transition} tp-000001`);
  }
});

test("验收标准与子任务同时不过时，说清 close 仍要先关子任务", () => {
  const a = report([acceptance, children]).actions.find(
    (x) => x.for === "acceptance" && x.command?.includes("--resolution wontfix"));
  assert.match(a?.detail ?? "", /child/i, "不说的话 agent 会以为这是条立刻见效的出路");
  const alone = report([acceptance]).actions.find(
    (x) => x.for === "acceptance" && x.command?.includes("--resolution wontfix"));
  assert.doesNotMatch(alone?.detail ?? "", /child/i, "只有验收标准那道门时不该提子任务");
});

test("reopen 的归属说明明说「没有可用的命令」", () => {
  const a = report([ownership], 3, "reopen").actions.find((x) => x.for === "ownership");
  assert.equal(a?.command, undefined);
  assert.match(a?.detail ?? "", /No command available/i,
    "简单地从文本里抓命令的调用方也得看得出这里没有命令");
});
