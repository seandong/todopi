// src/cli.ts
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT, CliError } from "./exit.ts";

const pkg = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
) as { version: string };

const program = new Command();
program
  .name("todopi")
  .description("A durable task ledger for AI coding agents")
  .version(pkg.version)
  .option("-C, --directory <dir>", "run against the ledger found from this directory")
  .option("--json", "emit structured data instead of human-readable text")
  .option("--quiet", "suppress progress and hints; keep results and errors")
  .option("--as <actor>", "act as this actor, for both writes and queries")
  .exitOverride();

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
      process.stdout.write(opts["json"] ? JSON.stringify(fix, null, 2) + "\n" : renderFixText(fix, { quiet: Boolean(opts["quiet"]) }));
      // FR-Q1：修完仍有问题则退出 1。
      if (!fix.after.ok) throw new CliError(EXIT.usage, "");
      return;
    }
    const report = runDoctor({ directory: (opts["directory"] as string | undefined) ?? process.cwd() });
    process.stdout.write(
      opts["json"] ? renderJson(report) + "\n" : renderText(report, { quiet: Boolean(opts["quiet"]) }),
    );
    if (!report.ok) throw new CliError(EXIT.usage, "");
  });

program
  .command("init")
  .description("create .todopi/ in this repository and write the todopi protocol into AGENTS.md")
  .option("--prefix <prefix>", "prefix for new task ids", "tp")
  .action(async (cmdOpts: { prefix: string }) => {
    const { runInit } = await import("./commands/init.ts");
    const { renderText, renderJson } = await import("./output/render/init.ts");
    const opts = program.opts();
    const report = runInit({
      directory: (opts["directory"] as string | undefined) ?? process.cwd(),
      prefix: cmdOpts.prefix,
    });
    process.stdout.write(
      opts["json"] ? renderJson(report) + "\n" : renderText(report, { quiet: Boolean(opts["quiet"]) }),
    );
  });

program
  .command("add")
  .argument("<title>", "what the task is")
  .description("create a task in the ledger")
  .option("-d, --description <text>", "longer description for the task body")
  .option("--ac <text...>", "acceptance criteria; repeat or pass several")
  .option("--label <label...>", "labels to attach")
  .option("--verify <command>", "command that must pass before this task can be done")
  .option("--parent <id>", "make this a child of another task")
  .option("--blocked-by <id...>", "tasks that must close before this one is ready")
  .option("--from <id>", "the task being worked on when this one was discovered")
  .action(async (title: string, cmdOpts: {
    description?: string; ac?: string[]; label?: string[];
    verify?: string; parent?: string; blockedBy?: string[]; from?: string;
  }) => {
    const { runAdd } = await import("./commands/add.ts");
    const { renderText, renderJson } = await import("./output/render/add.ts");
    const opts = program.opts();
    const report = runAdd({
      directory: (opts["directory"] as string | undefined) ?? process.cwd(),
      title,
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
      opts["json"] ? renderJson(report) + "\n" : renderText(report, { quiet: Boolean(opts["quiet"]) }),
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
  const { renderText, renderJson, renderDiagnostics } = await import("./output/render/ls.ts");
  const opts = program.opts();
  const { limit, ...rest } = cmdOpts;
  const report = runLs({
    directory: (opts["directory"] as string | undefined) ?? process.cwd(),
    ...rest,
    ...(limit === undefined ? {} : { limit: parseLimit(limit) }),
    actor: opts["as"] as string | undefined,
  });
  process.stdout.write(
    opts["json"] === true
      ? renderJson(report) + "\n"
      : renderText(report, { quiet: opts["quiet"] === true }),
  );
  // 诊断走 stderr：stdout 在 --json 下必须是一个干净的数组
  process.stderr.write(renderDiagnostics(report));
}

lsOptions(program.command("ls").description("list tasks in the ledger"))
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
    process.stdout.write(opts["json"] === true ? renderShowJson(report) + "\n" : renderShow(report));
  });

program
  .command("prime")
  .description("print what you are working on, and one line pointing at everything else")
  .option("--budget <tokens>", "approximate token budget for the output (default 600)")
  .option("--full", "print the full picture: your tasks, others', ready, counts, recently closed")
  .option("--session <id>", "the agent session this prime belongs to (for handoff); defaults to the actor")
  .action(async (cmdOpts: { budget?: string; full?: boolean; session?: string }) => {
    const { runPrime, runPrimeFull, parseBudget } = await import("./commands/prime.ts");
    const { renderPrime, renderPrimeFull } = await import("./output/render/prime.ts");
    const opts = program.opts();
    const base = {
      directory: (opts["directory"] as string | undefined) ?? process.cwd(),
      session: cmdOpts.session,
      actor: opts["as"] as string | undefined,
    };
    const json = opts["json"] === true;
    const { text, warnings } = cmdOpts.full === true
      ? ((r) => ({ text: json ? JSON.stringify(r.report, null, 2) + "\n" : renderPrimeFull(r.report), warnings: r.warnings }))(runPrimeFull(base))
      : ((r) => ({ text: json ? JSON.stringify(r.report, null, 2) + "\n" : renderPrime(r.report), warnings: r.warnings }))(
        runPrime({ ...base, budget: cmdOpts.budget === undefined ? undefined : parseBudget(cmdOpts.budget) }));
    process.stdout.write(text);
    for (const w of warnings) process.stderr.write(`${w}\n`);
  });

program
  .command("handoff")
  .description("report what this session did and log a handoff on your tasks; keeps your claims")
  .option("--check", "only print the report; write nothing and exit 0")
  .option("--session <id>", "the agent session to compare against (its last prime); defaults to the actor")
  .action(async (cmdOpts: { check?: boolean; session?: string }) => {
    const { runHandoff } = await import("./commands/handoff.ts");
    const { renderHandoff } = await import("./output/render/handoff.ts");
    const opts = program.opts();
    const report = runHandoff({
      directory: (opts["directory"] as string | undefined) ?? process.cwd(),
      session: cmdOpts.session,
      actor: opts["as"] as string | undefined,
      check: cmdOpts.check,
    });
    process.stdout.write(opts["json"] === true ? JSON.stringify(report, null, 2) + "\n" : renderHandoff(report));
    // 有任务没写成：以第一个失败的退出码退出（报告已经打印了哪些成功、哪些没有）。
    if (report.failed.length > 0) process.exitCode = report.failed[0]!.code;
  });

program
  .command("note")
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
    process.stdout.write(opts["json"] === true ? renderWorklogJson(report) + "\n" : renderNote(report));
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
    process.stdout.write(opts["json"] === true ? renderWorklogJson(report) + "\n" : renderCheck(report));
  });

const dir = (): string => (program.opts()["directory"] as string | undefined) ?? process.cwd();
const asActor = (): string | undefined => program.opts()["as"] as string | undefined;
const collect = (v: string, prev: string[]): string[] => [...prev, v];

program
  .command("edit")
  .description("change a task's title, description, verify command, labels or parent")
  .argument("<id>", "the task to edit")
  .option("--title <text>", "a new title")
  .option("-d, --description <text>", "replace the Description section; an empty string removes it")
  .option("--verify <command>", "a new verify command; an empty string removes it")
  .option("--label <label>", "+name adds a label, -name removes it; repeat for several", collect, [])
  .option("--parent <id>", "make it a child of another task; `none` detaches it")
  .action(async (id: string, o: { title?: string; description?: string; verify?: string; label: string[]; parent?: string }) => {
    const { runEdit } = await import("./commands/edit.ts");
    const { renderEdit, renderPlanJson } = await import("./output/render/plan.ts");
    const report = runEdit({
      directory: dir(), id, actor: asActor(),
      title: o.title, description: o.description, verify: o.verify,
      labels: o.label.length > 0 ? o.label : undefined, parent: o.parent,
    });
    process.stdout.write(program.opts()["json"] === true ? renderPlanJson(report) + "\n" : renderEdit(report));
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
    process.stdout.write(program.opts()["json"] === true ? renderPlanJson(report) + "\n" : renderMove(report));
  });

const dep = program.command("dep").description("add or remove a blocking dependency");
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
      process.stdout.write(program.opts()["json"] === true ? renderPlanJson(report) + "\n" : renderDep(report));
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
        : renderClaim(report, { quiet: opts["quiet"] === true }),
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
        : renderRelease(report, { quiet: opts["quiet"] === true }),
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
        : renderTransition(report, { quiet: opts["quiet"] === true }),
    );
  } catch (err) {
    if (err instanceof GateRefused) {
      process.stdout.write(
        opts["json"] === true ? renderGateJson(err.report) + "\n" : renderGateReport(err.report),
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

registerTransition(["done", "finish", "complete"], "done", "close a task as finished");
registerTransition(["close", "cancel"], "close", "close a task without finishing it",
  (c) => c.option("-r, --resolution <resolution>", "wontfix | duplicate | obsolete"));
registerTransition(["reopen"], "reopen", "put a closed task back to open");

try {
  await program.parseAsync(process.argv);
  process.exitCode = EXIT.ok;
} catch (err) {
  if (err instanceof CliError) {
    if (err.message) process.stderr.write(err.message + "\n");
    process.exitCode = err.code;
  } else if (err && typeof err === "object" && "exitCode" in err) {
    // commander 自己的 help / version / 用法错误
    process.exitCode = (err as { exitCode: number }).exitCode;
  } else {
    process.stderr.write(String(err) + "\n");
    process.exitCode = EXIT.usage;
  }
}
