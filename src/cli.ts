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
  .option("-C, --directory <dir>", "在该目录下查找 .todopi/ 并执行")
  .option("--json", "输出结构化数据而非人类可读文本")
  .option("--quiet", "抑制进度与提示性输出，只保留结果本身与错误")
  .exitOverride();

program
  .command("doctor")
  .description("检查账本是否符合格式规格，并报出违反的不变量")
  .action(async () => {
    // 动态 import 是为了让 --version 与 --help 不去加载 yaml——实测加载 yaml
    // 模块本身就要 10 ms，而那两条路径根本用不到它。
    const { runDoctor } = await import("./commands/doctor.ts");
    const { renderText, renderJson } = await import("./output/render/doctor.ts");
    const opts = program.opts();
    const report = runDoctor({ directory: (opts["directory"] as string | undefined) ?? process.cwd() });
    process.stdout.write(opts["json"] ? renderJson(report) + "\n" : renderText(report));
    if (!report.ok) throw new CliError(EXIT.usage, "");
  });

program
  .command("init")
  .description("在仓库里生成 .todopi/，并把 todopi 协议写进 AGENTS.md")
  .option("--prefix <prefix>", "新任务 id 的前缀", "tp")
  .action(async (cmdOpts: { prefix: string }) => {
    const { runInit } = await import("./commands/init.ts");
    const { renderText, renderJson } = await import("./output/render/init.ts");
    const opts = program.opts();
    const report = runInit({
      directory: (opts["directory"] as string | undefined) ?? process.cwd(),
      prefix: cmdOpts.prefix,
    });
    process.stdout.write(opts["json"] ? renderJson(report) + "\n" : renderText(report));
  });

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
