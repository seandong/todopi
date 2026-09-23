import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// ---- verify 的报告（F07）----

const verifyFail: Refusal = {
  gate: "verify", code: 2, command: "pnpm test", exitCode: 1, signal: null,
  timedOut: false, tail: "FAIL src/auth.test.ts\n  3 failing", logPath: "/repo/.todopi/.cache/verify/tp-000001-2026.log", logProblem: null,
};
const verifyTimeout: Refusal = {
  gate: "verify", code: 2, command: "pnpm test", exitCode: null, signal: "SIGKILL",
  timedOut: true, tail: "", logPath: "/repo/.todopi/.cache/verify/tp-000001-2026.log", logProblem: null,
};

test("verify 的报告带原样的命令、退出码与输出尾部", () => {
  const out = renderGateReport(report([verifyFail]));
  assert.match(out, /pnpm test/, "命令要原样出现（FR-D4）");
  assert.match(out, /exited 1/);
  assert.match(out, /FAIL src\/auth\.test\.ts/, "输出尾部要能直接看到");
  assert.match(out, /3 failing/);
});

test("超时说的是超时，不是「退出 null」", () => {
  const out = renderGateReport(report([verifyTimeout]));
  assert.match(out, /timed out/i);
  assert.doesNotMatch(out, /exited null/);
});

test("完整日志的路径作为动作交出去 —— agent 自己去读全文", () => {
  const r = report([verifyFail]);
  const read = r.actions.find((a) => a.for === "verify" && a.command?.startsWith("cat "));
  assert.ok(read, "--json 里要有读日志的动作");
  assert.ok(read.command?.includes(".cache/verify/"));
  assert.match(renderGateReport(r), /\.cache\/verify\//, "文本里也要有");
});

test("超时时给的建议是提高超时值，不是「修好它报的错」", () => {
  const detail = report([verifyTimeout]).actions
    .filter((a) => a.for === "verify").map((a) => a.detail).join(" ");
  assert.match(detail, /verify_timeout_seconds/);
});

test("verify 的动作里 command 不含占位符", () => {
  for (const r of [report([verifyFail]), report([verifyTimeout])]) {
    for (const a of r.actions) {
      if (a.command !== undefined) assert.doesNotMatch(a.command, /[<>]/, a.command);
    }
  }
});

test("完整输出没存下来时，报告不给 cat —— 给不出能跑的命令就别给命令", () => {
  // F06 第三轮的阻塞项是「报告给出的命令不可执行」。这是同一条线上的另一个
  // 入口：日志写不成时文件根本不在，`cat` 照着跑必然失败，而 FR-D2a 要的是
  // 一份「不需要再跑别的命令就能据以行动」的报告。
  const base = {
    gate: "verify" as const, code: 2 as const, command: "npm test",
    exitCode: 1, signal: null, timedOut: false, tail: "3 failing",
    logPath: "/repo/.todopi/.cache/verify/tp-000001-2026.log",
    logProblem: "could not write the verify log to /repo/.todopi/.cache/verify/tp-000001-2026.log: EACCES",
  };
  const actions = report([base]).actions;

  assert.equal(actions.filter((a) => a.command !== undefined && a.command.startsWith("cat ")).length, 0,
    "日志不在，却还是把 cat 交了出去");
  assert.ok(actions.some((a) => a.detail.includes("EACCES")),
    "既然给不了命令，至少要说清为什么没有全文");

  // 反过来：存下来了就必须给，否则 agent 只能看到 512 字节的尾部。
  const ok = report([{ ...base, logProblem: null }]).actions;
  assert.ok(ok.some((a) => a.command === `cat ${base.logPath}`), "存下来了却没给出读全文的路子");
});

test("报告里的 cat 在刁钻路径下也真能跑 —— 不是看起来对，是跑过", () => {
  // F06 第三轮的阻塞项是「报告给出的命令不可执行」，当时的形状是命令里留着
  // `<占位符>`。这是同一条线上更隐蔽的一个：仓库路径里有个空格，
  // `cat /Users/me/my repo/....log` 就被 shell 拆成了两个参数。
  //
  // **所以这条用例不比对字符串，它把命令交给 sh 去跑。** 断言的是「跑得通」，
  // 而不是「我以为的引号规则对」。
  for (const dirName of ["plain", "with space", "with'quote"]) {
    const root = mkdtempSync(join(tmpdir(), "todopi-q-"));
    const dir = join(root, dirName);
    mkdirSync(dir);
    const logPath = join(dir, "run.log");
    writeFileSync(logPath, "FULL-OUTPUT-MARKER\n");

    const actions = report([{
      gate: "verify", code: 2, command: "npm test", exitCode: 1, signal: null,
      timedOut: false, tail: "", logPath, logProblem: null,
    }]).actions;
    const cmd = actions.find((a) => a.command?.startsWith("cat ") === true)?.command;
    assert.ok(cmd !== undefined, `${dirName}：压根没给出读全文的命令`);

    const got = execFileSync("sh", ["-c", cmd], { encoding: "utf8" });
    assert.match(got, /FULL-OUTPUT-MARKER/, `${dirName}：这条命令跑不出全文 —— ${cmd}`);

    rmSync(root, { recursive: true, force: true });
  }
});
