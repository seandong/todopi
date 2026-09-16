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
