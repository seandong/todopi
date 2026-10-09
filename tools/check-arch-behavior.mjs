#!/usr/bin/env node
// 以真实运行结果执行一条架构规则；测试被删掉或跳过时也必须失败。
import { spawnSync } from "node:child_process";

const [file, name] = process.argv.slice(2);
if (!file || !name) {
  process.stdout.write("expected a test file and an exact test name\n");
  process.exitCode = 1;
} else {
  const pattern = `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", `--test-name-pattern=${pattern}`, file], {
    encoding: "utf8",
  });
  const output = result.stdout ?? "";
  if (result.status !== 0 || !output.includes(`# Subtest: ${name}\n`) || !/^# pass 1$/m.test(output) || !/^# fail 0$/m.test(output)) {
    process.stdout.write(`behavior check failed: ${file}: ${name}\n${output}${result.stderr ?? ""}`);
    process.exitCode = 1;
  }
}
