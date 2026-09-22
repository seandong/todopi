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
  .action(async () => {
    // 动态 import 是为了让 --version 与 --help 不去加载 yaml——实测加载 yaml
    // 模块本身就要 10 ms，而那两条路径根本用不到它。
    const { runDoctor } = await import("./commands/doctor.ts");
    const { renderText, renderJson } = await import("./output/render/doctor.ts");
    const opts = program.opts();
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
