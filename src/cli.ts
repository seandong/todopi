// src/cli.ts
// 命令解析。入口是 src/main.ts（它先判断这次是不是 verify 的 runner）；开发时直接 `node src/cli.ts` 也行。
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { EXIT, CliError } from "./exit.ts";
import { VERSION } from "./version.ts";
import { chooseStyle } from "./output/style.ts";
import { agentPresent } from "./commands/actor.ts";

const program = new Command();
program
  .name("todopi")
  .description("A durable task ledger for AI coding agents")
  .version(VERSION)
  .option("-C, --directory <dir>", "run against the ledger found from this directory")
  .option("--json", "emit structured data instead of human-readable text")
  .option("--quiet", "suppress progress and hints; keep results and errors")
  .option("--as <actor>", "act as this actor, for both writes and queries")
  .option("--agent <name>", "the coding agent running this command (claude-code, codex, gemini, opencode, pi, cursor); "
    + "sets the actor to <name>@<host>. Hooks installed by `todopi setup` pass it; agents are also recognized from their environment")
  .exitOverride();

// Commander 的帮助格式化是同步的；沿用 chooseStyle 的判定，不改变帮助文本的内容和换行。
// argv 要在 preAction 前读取：--help 与 `help <command>` 不会执行命令 action。
const helpStyle = () => chooseStyle({
  json: program.opts()["json"] === true || process.argv.includes("--json"),
  hook: process.argv.some((arg) => ["--hook", "--hook-json", "--if-compacted", "--mark-compacted"].some((flag) => arg === flag || arg.startsWith(`${flag}=`))),
  agent: agentPresent() || process.argv.includes("--agent") || process.argv.some((arg) => arg.startsWith("--agent=")),
  env: process.env,
  isTTY: process.stdout.isTTY === true,
});
program.configureOutput({ getOutHasColors: () => helpStyle().bold("x") !== "x" });
program.configureHelp({
  styleTitle: (text) => helpStyle().bold(text),
  styleCommandText: (text) => helpStyle().bold(text),
  styleOptionText: (text) => helpStyle().cyan(text),
  styleSubcommandText: (text) => helpStyle().cyan(text),
  styleArgumentText: (text) => helpStyle().dim(text),
});

// --agent 交给身份解析（只在本进程里，不放进环境——见 setAgentOption）。F22
program.hook("preAction", async () => {
  const { setAgentOption } = await import("./commands/actor.ts");
  setAgentOption(program.opts()["agent"] as string | undefined);
  // 账本的格式版本比本实现高：读命令照常，先说一句（写命令会在写之前退出 4）。spec §9，F25
  if (program.opts()["quiet"] !== true) {
    const { findLedger, isNewerVersion, newerVersionNote } = await import("./format/discover.ts");
    let ledger = null;
    // 坏的 config 由命令自己报，这里只管提示
    try { ledger = findLedger((program.opts()["directory"] as string | undefined) ?? process.cwd()); } catch { ledger = null; }
    if (ledger !== null && isNewerVersion(ledger)) process.stderr.write(`${newerVersionNote(ledger)}\n`);
  }
});

/**
 * 这次输出要不要上色（tp-rk6o8q）：判定只在 output/style.ts 的 chooseStyle 里，这里只收集事实。钩子路径由调用方说（hook）。
 */
async function styleFor(hook = false, stream: NodeJS.WriteStream = process.stdout) {
  const { chooseStyle } = await import("./output/style.ts");
  const { agentPresent } = await import("./commands/actor.ts");
  return chooseStyle({
    json: program.opts()["json"] === true,
    hook,
    agent: agentPresent(),
    env: process.env,
    isTTY: stream.isTTY === true,
  });
}

/**
 * 错误写到 stderr：第一行加 `error: `（Cargo 式，tp-rk6o8q）；上不上色看 stderr 是不是终端。
 * 消息里可能带着用户给的数据（任务 id、路径）：每一行的控制字符（ESC、Tab……）一律可见转义，第二行起缩进两格——
 * 数据里夹带的换行因此伪造不出一行从行首开始的 `error:`（评审一、二轮）。选了 PLAIN 也挡不住数据自己带的控制字符。
 */
async function writeError(raw: string): Promise<void> {
  const { diagnostic } = await import("./output/render/layout.ts");
  const { visible } = await import("./domain/visible.ts");
  const message = raw.split("\n").map((line, i) => (i === 0 ? visible(line) : `  ${visible(line)}`)).join("\n");
  let style;
  // 身份解析出错（未知的 --agent）也会走到这里：判定本身不能再抛
  try { style = await styleFor(false, process.stderr); } catch { style = (await import("./output/style.ts")).PLAIN; }
  process.stderr.write(`${diagnostic(style, "error", message)}\n`);
}

program
  .command("doctor")
  .description("check the ledger against the format spec and report violated invariants")
  .option("--fix", "normalize what can be fixed mechanically (never the Log, never `updated`), then check")
  .action(async (cmdOpts: { fix?: boolean }) => {
    // 动态 import 是为了让 --version 与 --help 不去加载 yaml——实测加载 yaml
    // 模块本身就要 10 ms，而那两条路径根本用不到它。
    const { runDoctor } = await import("./commands/doctor.ts");
    const { renderText, renderJson, renderFixText } = await import("./output/render/doctor.ts");
    const opts = program.opts();
    if (cmdOpts.fix === true) {
      const { runDoctorFix } = await import("./commands/doctor-fix.ts");
      const fix = runDoctorFix({ directory: (opts["directory"] as string | undefined) ?? process.cwd() });
      process.stdout.write(opts["json"] ? JSON.stringify(fix, null, 2) + "\n" : renderFixText(fix, { quiet: Boolean(opts["quiet"]), style: await styleFor() }));
      // FR-Q1：修完仍有问题则退出 1。
      if (!fix.after.ok) throw new CliError(EXIT.usage, "");
      return;
    }
    const report = runDoctor({ directory: (opts["directory"] as string | undefined) ?? process.cwd() });
    process.stdout.write(
      opts["json"] ? renderJson(report) + "\n" : renderText(report, { quiet: Boolean(opts["quiet"]), style: await styleFor() }),
    );
    if (!report.ok) throw new CliError(EXIT.usage, "");
  });

program
  .command("init")
  .description("create .todopi/ in this repository and write the todopi protocol into AGENTS.md")
  .option("--prefix <prefix>", "prefix for new task ids", "tp")
  .option("--setup <agent>", "also run `todopi setup <agent>` for the project (repeatable or comma-separated: claude, codex, opencode, pi, cursor, gemini)",
    (value: string, previous: string[]) => [...previous, value], [] as string[])
  .action(async (cmdOpts: { prefix: string; setup: string[] }) => {
    const { runInit } = await import("./commands/init.ts");
    const { renderText, renderJson } = await import("./output/render/init.ts");
    const opts = program.opts();
    const report = runInit({
      directory: (opts["directory"] as string | undefined) ?? process.cwd(),
      prefix: cmdOpts.prefix,
      ...(cmdOpts.setup.length > 0 ? { setup: cmdOpts.setup } : {}),
    });
    process.stdout.write(
      opts["json"] ? renderJson(report) + "\n" : renderText(report, { quiet: Boolean(opts["quiet"]), style: await styleFor(), home: homedir() }),
    );
  });

program
  .command("add")
  .aliases(["new", "create"])
  // 用 --edit 时标题可以留到编辑器里写
  .argument("[title]", "what the task is (optional with --edit)")
  // commander 的帮助只列第一个别名：把全部写进描述，create 才看得见（Codex 评审）
  .description("create a task in the ledger (also: new, create)")
  .option("-d, --description <text>", "longer description for the task body")
  .option("--ac <text...>", "acceptance criteria; repeat or pass several")
  .option("--label <label...>", "labels to attach")
  .option("--verify <command>", "command that must pass before this task can be done")
  .option("--parent <id>", "make this a child of another task")
  .option("--blocked-by <id...>", "tasks that must close before this one is ready")
  .option("--from <id>", "the task being worked on when this one was discovered")
  .option("--plan <text>", "the Plan section: how the work will be done")
  .option("--edit", "open $VISUAL / $EDITOR on the new task (prefilled from the other options) before creating it")
  .action(async (title: string | undefined, cmdOpts: {
    description?: string; ac?: string[]; label?: string[];
    verify?: string; parent?: string; blockedBy?: string[]; from?: string; plan?: string; edit?: boolean;
  }) => {
    if (title === undefined && cmdOpts.edit !== true) {
      throw new CliError(EXIT.usage, "add needs a title: todopi add \"<title>\" (or --edit to write it in an editor).");
    }
    const { runAdd, runAddInEditor } = await import("./commands/add.ts");
    const { renderText, renderJson } = await import("./output/render/add.ts");
    const opts = program.opts();
    const report = (cmdOpts.edit === true ? runAddInEditor : runAdd)({
      plan: cmdOpts.plan,
      directory: (opts["directory"] as string | undefined) ?? process.cwd(),
      title: title ?? "",
      description: cmdOpts.description,
      acceptance: cmdOpts.ac,
      labels: cmdOpts.label,
      verify: cmdOpts.verify,
      parent: cmdOpts.parent,
      blockedBy: cmdOpts.blockedBy,
      from: cmdOpts.from,
      actor: opts["as"] as string | undefined,
    });
    process.stdout.write(
      opts["json"] ? renderJson(report) + "\n" : renderText(report, { quiet: Boolean(opts["quiet"]), style: await styleFor() }),
    );
  });

type LsCmdOptions = {
  all?: boolean; closed?: boolean; ready?: boolean; blocked?: boolean;
  mine?: boolean; label?: string; limit?: string; open?: boolean;
};

/**
 * `ls` 与它的别名 `ready` 共享同一套选项和同一个 action。
 *
 * 别名必须接受基础命令的全部选项，否则 `todopi ready --limit 5` 会被拒——
 * 那就不是别名了。实现上转发，不复制逻辑。
 * 别名不计入 20 个子命令的上限（PRD §8 明文）。
 */
function lsOptions(cmd: Command): Command {
  return cmd
    .option("--open", "only tasks that are not closed (the default)")
    .option("--all", "include closed tasks")
    .option("--closed", "only closed tasks")
    .option("--blocked", "only tasks waiting on another task")
    .option("--mine", "only tasks assigned to you or to an agent on this machine")
    .option("--label <label>", "only tasks carrying this label")
    // 不给 commander 传解析函数：Number.parseInt 会把 "1.5" 读成 1、"0x10" 读成 0，
    // 于是坏的输入悄悄变成一个合法但错误的数。原样收下字符串，由 parseLimit 严格校验。
    .option("--limit <n>", "show at most this many");
}

async function lsAction(cmdOpts: LsCmdOptions): Promise<void> {
  const { runLs, parseLimit } = await import("./commands/ls.ts");
  const { renderText, renderJson, renderDiagnostics, renderNotes } = await import("./output/render/ls.ts");
  const opts = program.opts();
  const { limit, ...rest } = cmdOpts;
  const report = runLs({
    directory: (opts["directory"] as string | undefined) ?? process.cwd(),
    ...rest,
    ...(limit === undefined ? {} : { limit: parseLimit(limit) }),
    actor: opts["as"] as string | undefined,
  });
  const style = await styleFor();
  process.stdout.write(
    opts["json"] === true
      ? renderJson(report) + "\n"
      : renderText(report, { quiet: opts["quiet"] === true, style }),
  );
  // 没人在看时「没有匹配」「只显示了几条」走 stderr：stdout 只有数据行（--json 下 stdout 已经是干净的数组，不重复说）
  if (opts["json"] !== true) process.stderr.write(renderNotes(report, { quiet: opts["quiet"] === true, style }));
  // 诊断走 stderr：stdout 在 --json 下必须是一个干净的数组
  process.stderr.write(renderDiagnostics(report));
}

lsOptions(program.command("ls").alias("list").description("list tasks in the ledger"))
  .option("--ready", "only tasks that can be claimed right now")
  .action(lsAction);

lsOptions(program.command("ready").description("alias for `ls --ready`"))
  .action(async (cmdOpts: LsCmdOptions) => { await lsAction({ ...cmdOpts, ready: true }); });

program
  .command("show")
  .description("print one task in detail")
  .argument("<id>", "the task to show")
  .option("--full", "show every Log entry, not just the last five")
  .option("--tree", "show the parent chain and the children with their progress")
  .action(async (id: string, cmdOpts: { full?: boolean; tree?: boolean }) => {
    const { runShow } = await import("./commands/show.ts");
    const { renderShow, renderShowJson } = await import("./output/render/show.ts");
    const opts = program.opts();
    const report = runShow({
      directory: (opts["directory"] as string | undefined) ?? process.cwd(),
      id,
      full: cmdOpts.full,
      tree: cmdOpts.tree,
      actor: opts["as"] as string | undefined,
    });
    process.stdout.write(opts["json"] === true ? renderShowJson(report) + "\n" : renderShow(report, { style: await styleFor() }));
  });

/**
 * `--hook`：钩子调用时，会话 id 从 stdin 的 JSON 里取；没有账本就静默退出 0（用户级钩子在每个项目里都会
 * 触发）。stdin 是终端时不读——手动试跑 `--hook` 不该卡住等输入。
 *
 * 目录：没用 -C 指定时，载荷里有 Cursor 的 `workspace_roots` 就用它的第一项——Cursor 的用户级钩子在
 * `~/.cursor/` 里运行，不在项目根（官方文档），按工作目录找账本永远找不到（F17）。
 */
async function hookContext(explicit: string | undefined): Promise<{ skip: boolean; session?: string; occasion?: string; directory: string }> {
  const { findLedger } = await import("./format/discover.ts");
  const { sessionFromHookPayload, directoryFromHookPayload, occasionFromHookPayload } = await import("./commands/hook.ts");
  let payload = "";
  if (process.stdin.isTTY !== true) {
    try { payload = readFileSync(0, "utf8"); } catch { payload = ""; }
  }
  const directory = explicit ?? directoryFromHookPayload(payload) ?? process.cwd();
  if (findLedger(directory) === null) return { skip: true, directory };
  return { skip: false, session: sessionFromHookPayload(payload), occasion: occasionFromHookPayload(payload), directory };
}

program
  .command("prime")
  .description("print what you are working on, and one line pointing at everything else")
  .option("--budget <tokens>", "approximate token budget for the output (default 600)")
  .option("--full", "print the full picture: your tasks, others', ready, counts, recently closed")
  .option("--session <id>", "the agent session this prime belongs to (for handoff); defaults to the actor")
  .option("--hook", "called from an agent hook: read the session id from the JSON on stdin; stay silent without a ledger")
  .option("--hook-json <shape>", "wrap the output as the hook JSON an agent expects: cursor, gemini:SessionStart, gemini:BeforeAgent")
  .option("--mark-compacted", "record that this session was just compacted, print nothing (for a pre-compaction hook)")
  .option("--if-compacted", "print only if --mark-compacted was recorded for this session since, and clear it (for a before-turn hook)")
  .option("--hook-event <name>", "which agent event this hook call is for, when the hook JSON does not say (the pi extension passes it)")
  .action(async (cmdOpts: { budget?: string; full?: boolean; session?: string; hook?: boolean; hookJson?: string; markCompacted?: boolean; ifCompacted?: boolean; hookEvent?: string }) => {
    const { runPrime, runPrimeFull, parseBudget } = await import("./commands/prime.ts");
    const { renderPrime, renderPrimeFull } = await import("./output/render/prime.ts");
    const { compactionGate, wrapHookOutput, firstInjection } = await import("./commands/hook.ts");
    const opts = program.opts();
    const explicit = opts["directory"] as string | undefined;
    const hook = cmdOpts.hook === true ? await hookContext(explicit) : { skip: false, session: undefined, directory: explicit ?? process.cwd() };
    const directory = hook.directory;
    if (hook.skip) return;
    const base = {
      directory,
      session: cmdOpts.session ?? hook.session,
      actor: opts["as"] as string | undefined,
    };
    // 压缩标记（D038）：压缩前的钩子只打标记；每轮之前的钩子只在标记在时才往下走。
    if (cmdOpts.markCompacted === true) { compactionGate(directory, "mark", base.session, base.actor); return; }
    if (cmdOpts.ifCompacted === true && !compactionGate(directory, "take", base.session, base.actor)) return;
    // 钩子里的去重（F38）：同一 agent、同一事件与来源、同一会话，10 秒内只有第一份钩子往下走——setup 的钩子与市场包同时装了时
    // 不注入两遍。**在 prime 之前判**：被挡下的这一份什么都不做，也不写 prime 记录（否则会挪动 handoff 的 verify 基准——评审）。
    // --if-compacted 不在此列：压缩后的再注入已经由压缩标记把关。没有会话 id 不去重。
    if (cmdOpts.hook === true && cmdOpts.ifCompacted !== true && base.session !== undefined) {
      const agent = (opts["agent"] as string | undefined) ?? process.env["TODOPI_AGENT"] ?? "";
      // 事件：钩子 JSON 里的 hook_event_name / source，或 --hook-event（pi 的扩展给不了 stdin）
      const occasion = cmdOpts.hookEvent !== undefined ? `${cmdOpts.hookEvent}/` : ("occasion" in hook ? hook.occasion ?? "" : "");
      if (!firstInjection(directory, `${agent}|${occasion}|${base.session}`)) return;
    }
    const json = opts["json"] === true;
    const { text, warnings } = cmdOpts.full === true
      ? ((r) => ({ text: json ? JSON.stringify(r.report, null, 2) + "\n" : renderPrimeFull(r.report), warnings: r.warnings }))(runPrimeFull(base))
      : ((r) => ({ text: json ? JSON.stringify(r.report, null, 2) + "\n" : renderPrime(r.report), warnings: r.warnings }))(
        runPrime({ ...base, budget: cmdOpts.budget === undefined ? undefined : parseBudget(cmdOpts.budget) }));
    process.stdout.write(cmdOpts.hookJson === undefined ? text : wrapHookOutput(cmdOpts.hookJson, text));
    for (const w of warnings) process.stderr.write(`${w}\n`);
  });

program
  .command("handoff")
  .description("report what this session did and log a handoff on your tasks; keeps your claims")
  .option("--check", "only print the report; write nothing and exit 0")
  .option("--session <id>", "the agent session to compare against (its last prime); defaults to the actor")
  .option("--hook", "called from an agent hook: read the session id from the JSON on stdin; stay silent without a ledger")
  .action(async (cmdOpts: { check?: boolean; session?: string; hook?: boolean }) => {
    const { runHandoff } = await import("./commands/handoff.ts");
    const { renderHandoff } = await import("./output/render/handoff.ts");
    const opts = program.opts();
    const explicit = opts["directory"] as string | undefined;
    const hook = cmdOpts.hook === true ? await hookContext(explicit) : { skip: false, session: undefined, directory: explicit ?? process.cwd() };
    const directory = hook.directory;
    if (hook.skip) return;
    const report = runHandoff({
      directory,
      session: cmdOpts.session ?? hook.session,
      actor: opts["as"] as string | undefined,
      check: cmdOpts.check,
    });
    process.stdout.write(opts["json"] === true ? JSON.stringify(report, null, 2) + "\n" : renderHandoff(report));
    // 有任务没写成：以第一个失败的退出码退出（报告已经打印了哪些成功、哪些没有）。
    if (report.failed.length > 0) process.exitCode = report.failed[0]!.code;
  });

program
  .command("setup")
  .description("install the agent's hooks and rule-file import so every session starts with `todopi prime`")
  .argument("<agent>", "which agent: claude, codex, opencode, pi, cursor, gemini")
  .option("--user", "write user-level hooks (in your home directory) instead of the project's")
  .action(async (agent: string, cmdOpts: { user?: boolean }) => {
    const { runSetup } = await import("./commands/setup.ts");
    const { renderSetup } = await import("./output/render/setup.ts");
    const opts = program.opts();
    const directory = (opts["directory"] as string | undefined) ?? process.cwd();
    const report = runSetup({ directory, agent, user: cmdOpts.user });
    const { findLedger } = await import("./format/discover.ts");
    process.stdout.write(opts["json"] === true ? JSON.stringify(report, null, 2) + "\n"
      : renderSetup(report, { quiet: opts["quiet"] === true, style: await styleFor(), home: homedir(), root: findLedger(directory)?.root }));
  });

program
  .command("note")
  .alias("log")
  .description("append a line to a task's log; the text may span several lines")
  .argument("<id>", "the task to note on")
  .argument("<text>", "what happened and why")
  .action(async (id: string, text: string) => {
    const { runNote } = await import("./commands/note.ts");
    const { renderNote, renderWorklogJson } = await import("./output/render/worklog.ts");
    const opts = program.opts();
    const report = runNote({
      directory: (opts["directory"] as string | undefined) ?? process.cwd(),
      id, text, actor: opts["as"] as string | undefined,
    });
    process.stdout.write(opts["json"] === true ? renderWorklogJson(report) + "\n" : renderNote(report, { style: await styleFor() }));
  });

program
  .command("check")
  .description("tick acceptance criterion <n> of a task, or untick it with --undo")
  .argument("<id>", "the task")
  .argument("<n>", "the criterion number, as shown by todopi show")
  .option("--undo", "untick it instead")
  .action(async (id: string, n: string, cmdOpts: { undo?: boolean }) => {
    const { runCheck, parseCriterionNumber } = await import("./commands/check.ts");
    const { renderCheck, renderWorklogJson } = await import("./output/render/worklog.ts");
    const opts = program.opts();
    const report = runCheck({
      directory: (opts["directory"] as string | undefined) ?? process.cwd(),
      id, n: parseCriterionNumber(n), undo: cmdOpts.undo, actor: opts["as"] as string | undefined,
    });
    process.stdout.write(opts["json"] === true ? renderWorklogJson(report) + "\n" : renderCheck(report, { style: await styleFor() }));
  });

const dir = (): string => (program.opts()["directory"] as string | undefined) ?? process.cwd();
const asActor = (): string | undefined => program.opts()["as"] as string | undefined;
const collect = (v: string, prev: string[]): string[] => [...prev, v];

program
  .command("edit")
  .description("change a task's title, description, verify command, labels, parent, acceptance criteria or plan")
  .argument("<id>", "the task to edit")
  .option("--title <text>", "a new title")
  .option("-d, --description <text>", "replace the Description section; an empty string removes it")
  .option("--verify <command>", "a new verify command; an empty string removes it")
  .option("--label <label>", "+name adds a label, -name removes it; repeat for several", collect, [])
  .option("--parent <id>", "make it a child of another task; `none` detaches it")
  .option("--plan <text>", "replace the Plan section; an empty string removes it")
  .option("--ac-add <text>", "add an unchecked acceptance criterion; repeat for several", collect, [])
  .option("--ac-set <n=text>", "change the text of unchecked criterion n; repeat for several", collect, [])
  .option("--ac-rm <n>", "remove unchecked criterion n; repeat for several", collect, [])
  .option("--edit", "open $VISUAL / $EDITOR on the title, description, acceptance criteria and plan")
  .action(async (id: string, o: {
    title?: string; description?: string; verify?: string; label: string[]; parent?: string;
    plan?: string; acAdd: string[]; acSet: string[]; acRm: string[]; edit?: boolean;
  }) => {
    const { runEdit, runEditInEditor, parseCriterionNumber } = await import("./commands/edit.ts");
    const { renderEdit, renderPlanJson } = await import("./output/render/plan.ts");
    const set = new Map<number, string>();
    for (const raw of o.acSet) {
      const at = raw.indexOf("=");
      if (at < 0) throw new CliError(EXIT.usage, `--ac-set needs <n>=<text>; got ${JSON.stringify(raw)}.`);
      set.set(parseCriterionNumber(raw.slice(0, at), "--ac-set"), raw.slice(at + 1));
    }
    const criteria = { add: o.acAdd, set, remove: new Set(o.acRm.map((n) => parseCriterionNumber(n, "--ac-rm"))) };
    const report = (o.edit === true ? runEditInEditor : runEdit)({
      directory: dir(), id, actor: asActor(),
      title: o.title, description: o.description, verify: o.verify,
      labels: o.label.length > 0 ? o.label : undefined, parent: o.parent,
      plan: o.plan, criteria,
    });
    process.stdout.write(program.opts()["json"] === true ? renderPlanJson(report) + "\n" : renderEdit(report, { style: await styleFor() }));
  });

program
  .command("move")
  .description("change where a task sits in the queue; the only way to change its rank")
  .argument("<id>", "the task to move")
  .option("--top", "put it first")
  .option("--before <id>", "put it right before another task")
  .option("--after <id>", "put it right after another task")
  .action(async (id: string, o: { top?: boolean; before?: string; after?: string }) => {
    const { runMove } = await import("./commands/move.ts");
    const { renderMove, renderPlanJson } = await import("./output/render/plan.ts");
    const report = runMove({ directory: dir(), id, actor: asActor(), top: o.top, before: o.before, after: o.after });
    process.stdout.write(program.opts()["json"] === true ? renderPlanJson(report) + "\n" : renderMove(report, { style: await styleFor() }));
  });

const dep = program.command("dep").alias("block").description("add or remove a blocking dependency");
for (const op of ["add", "rm"] as const) {
  dep
    .command(op)
    .description(op === "add" ? "make <id> wait for another task" : "stop <id> waiting for another task")
    .argument("<id>", "the task that waits")
    .requiredOption("--on <id>", "the task it waits for")
    .action(async (id: string, o: { on: string }) => {
      const { runDep } = await import("./commands/dep.ts");
      const { renderDep, renderPlanJson } = await import("./output/render/plan.ts");
      const report = runDep({ directory: dir(), op, id, on: o.on, actor: asActor() });
      process.stdout.write(program.opts()["json"] === true ? renderPlanJson(report) + "\n" : renderDep(report, { style: await styleFor() }));
    });
}

program
  .command("claim")
  .description("take ownership of a task and start working on it")
  .argument("<id>", "the task to claim")
  .option("--steal", "take over a task whose lease has not expired yet")
  .action(async (id: string, cmdOpts: { steal?: boolean }) => {
    const { runClaim } = await import("./commands/claim.ts");
    const { renderClaim, renderClaimJson } = await import("./output/render/claim.ts");
    const opts = program.opts();
    const report = runClaim({
      directory: (opts["directory"] as string | undefined) ?? process.cwd(),
      id,
      steal: cmdOpts.steal,
      actor: opts["as"] as string | undefined,
    });
    process.stdout.write(
      opts["json"] === true
        ? renderClaimJson(report) + "\n"
        : renderClaim(report, { quiet: opts["quiet"] === true, style: await styleFor() }),
    );
  });

program
  .command("release")
  .description("give a task back so anyone can claim it")
  .argument("<id>", "the task to release")
  .action(async (id: string) => {
    const { runRelease } = await import("./commands/release.ts");
    const { renderRelease, renderReleaseJson } = await import("./output/render/claim.ts");
    const opts = program.opts();
    const report = runRelease({
      directory: (opts["directory"] as string | undefined) ?? process.cwd(),
      id,
      actor: opts["as"] as string | undefined,
    });
    process.stdout.write(
      opts["json"] === true
        ? renderReleaseJson(report) + "\n"
        : renderRelease(report, { quiet: opts["quiet"] === true, style: await styleFor() }),
    );
  });

type TransitionCmdOptions = { force?: boolean; reason?: string; resolution?: string; yes?: boolean };

/**
 * 三条迁移命令共用的出口。门禁拒绝时打印 FR-D2a 的报告并按 worstCode 退出——
 * 那份报告是 agent 唯一能看到的东西，所以它走 stdout 而不是 stderr：
 * `--json` 下它就是结构化的拒绝，agent 解析它来决定修什么。
 */
async function transitionAction(
  kind: "done" | "close" | "reopen",
  id: string,
  cmdOpts: TransitionCmdOptions,
): Promise<void> {
  const { GateRefused } = await import("./commands/transition.ts");
  const { renderGateReport, renderGateJson, renderTransition, renderTransitionJson } =
    await import("./output/render/gate.ts");
  const opts = program.opts();
  const common = {
    directory: (opts["directory"] as string | undefined) ?? process.cwd(),
    id,
    actor: opts["as"] as string | undefined,
    force: cmdOpts.force,
    reason: cmdOpts.reason,
    ...(kind === "done" ? { yes: cmdOpts.yes } : {}),
  };

  try {
    const run = kind === "done"
      ? (await import("./commands/done.ts")).runDone
      : kind === "close"
        ? (await import("./commands/close.ts")).runClose
        : (await import("./commands/reopen.ts")).runReopen;
    const report = run({ ...common, ...(kind === "close" ? { resolution: cmdOpts.resolution } : {}) });
    process.stdout.write(
      opts["json"] === true
        ? renderTransitionJson(report) + "\n"
        : renderTransition(report, { quiet: opts["quiet"] === true, style: await styleFor() }),
    );
  } catch (err) {
    if (err instanceof GateRefused) {
      process.stdout.write(
        opts["json"] === true ? renderGateJson(err.report) + "\n" : renderGateReport(err.report, { style: await styleFor() }),
      );
      throw new CliError(err.code as 2 | 3, "");
    }
    throw err;
  }
}

/** FR-Q4 的动词宽容。别名接受与基础命令完全相同的选项，且不计入 20 个子命令上限。 */
function registerTransition(
  names: string[],
  kind: "done" | "close" | "reopen",
  describe: string,
  extra: (c: Command) => Command = (c) => c,
): void {
  for (const [i, name] of names.entries()) {
    const cmd = program.command(name)
      .description(i === 0 ? describe : `alias for \`${names[0]}\``)
      .argument("<id>", "the task to change");
    if (kind !== "reopen") {
      cmd.option("--force", "override every gate; requires --reason")
        .option("--reason <text>", "why the gate was overridden; recorded in the task log");
    }
    // FR-D4：首次在某个仓库执行 verify 前要求确认。--yes 是那次批准。
    if (kind === "done") cmd.option("--yes", "trust this repository to run its verify commands");
    extra(cmd).action(async (id: string, cmdOpts: TransitionCmdOptions) => {
      await transitionAction(kind, id, cmdOpts);
    });
  }
}

program
  .command("import")
  .argument("<file>", "a Markdown plan with checkbox items (Superpowers plan, spec-kit or OpenSpec tasks.md), or \"beads\"")
  .argument("[path]", "with \"beads\": the Beads Classic issues.jsonl (default .beads/issues.jsonl)")
  .description("turn a Markdown checkbox plan into tasks (headings become parents, items become tasks, in document order), "
    + "or migrate a Beads Classic export with `import beads [path]`")
  .action(async (file: string, path: string | undefined) => {
    const opts = program.opts();
    const directory = (opts["directory"] as string | undefined) ?? process.cwd();
    const actor = opts["as"] as string | undefined;
    // `beads` 是子命令：要导入一个叫 beads 的 Markdown 文件，写成 ./beads
    if (file === "beads") {
      const { runImportBeads } = await import("./commands/import-beads.ts");
      const { renderImportBeads } = await import("./output/render/import-beads.ts");
      const report = runImportBeads({ directory, path, actor });
      process.stdout.write(opts["json"] ? JSON.stringify(report, null, 2) + "\n" : renderImportBeads(report, { quiet: opts["quiet"] === true, style: await styleFor() }));
      return;
    }
    if (path !== undefined) throw new CliError(EXIT.usage, `import takes one plan file; got an extra argument ${JSON.stringify(path)}.`);
    const { runImport } = await import("./commands/import.ts");
    const { renderImport } = await import("./output/render/import.ts");
    const report = runImport({ directory, file, actor });
    process.stdout.write(opts["json"] ? JSON.stringify(report, null, 2) + "\n" : renderImport(report, { quiet: opts["quiet"] === true, style: await styleFor() }));
  });

program
  .command("web")
  .description("serve a read-only board of the ledger on 127.0.0.1 that updates as the files change")
  .option("--port <n>", "port to listen on, on 127.0.0.1 only (default 4747)")
  .option("--open", "open the board in your browser")
  .option("--poll", "watch the files by polling (for container mounts where change events do not arrive)")
  .action(async (cmdOpts: { port?: string; open?: boolean; poll?: boolean }) => {
    const { runBoard, parsePort, DEFAULT_PORT } = await import("./commands/board.ts");
    const { BOARD_PAGE } = await import("./output/render/board-page.ts");
    const { startBoardServer, PortInUseError } = await import("./board/server.ts");
    const { openInBrowser } = await import("./board/open.ts");
    const { discoverLedger } = await import("./format/discover.ts");
    const opts = program.opts();
    const directory = (opts["directory"] as string | undefined) ?? process.cwd();
    const actor = opts["as"] as string | undefined;
    const port = cmdOpts.port === undefined ? DEFAULT_PORT : parsePort(cmdOpts.port);
    const ledger = discoverLedger(directory);
    // FR-B1：前台进程，不装信号处理——Ctrl+C（SIGINT）与关掉终端（SIGHUP）的默认行为就是结束进程。
    // 端口被占用就报错退出，不换端口：换了用户就不知道看板在哪。
    const server = await startBoardServer({
      port, page: BOARD_PAGE, watchDir: ledger.dir, poll: cmdOpts.poll,
      build: () => JSON.stringify(runBoard({ directory, actor })),
    }).catch((err: unknown) => {
      if (err instanceof PortInUseError) {
        throw new CliError(EXIT.usage, `Port ${port} on 127.0.0.1 is already in use. Pick another with --port <n>.`);
      }
      throw err;
    });
    const url = `http://127.0.0.1:${server.port}/`;
    // 地址是结果；后面那句是提示，--quiet 去掉
    const { action, diagnostic } = await import("./output/render/layout.ts");
    const style = await styleFor();
    process.stdout.write(`${action(style, "Serving", `todopi board at ${url}`)}\n`
      + (opts["quiet"] === true ? "" : `${diagnostic(style, "note", `read-only; ${server.mode === "poll" ? "polling" : "watching"} ${ledger.dir} for changes. Press Ctrl+C to stop.`)}\n`));
    if (cmdOpts.open === true && !(await openInBrowser(url))) {
      process.stderr.write(`Could not open a browser; open ${url} yourself.\n`);
    }
  });

registerTransition(["done", "finish", "complete"], "done", "close a task as finished");
registerTransition(["close", "cancel"], "close", "close a task without finishing it",
  (c) => c.option("-r, --resolution <resolution>", "wontfix | duplicate | obsolete"));
registerTransition(["reopen"], "reopen", "put a closed task back to open");

try {
  await program.parseAsync(process.argv);
  process.exitCode = EXIT.ok;
} catch (err) {
  if (err instanceof CliError) {
    if (err.message) await writeError(err.message);
    process.exitCode = err.code;
  } else if (err && typeof err === "object" && "exitCode" in err) {
    // commander 自己的 help / version / 用法错误
    process.exitCode = (err as { exitCode: number }).exitCode;
  } else {
    await writeError(String(err));
    process.exitCode = EXIT.usage;
  }
}
