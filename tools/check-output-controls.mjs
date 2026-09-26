// tools/check-output-controls.mjs —— ARCH-027 的检查器：注入进模型上下文的输出（prime、handoff）里
// 没有原始控制字符。
//
// 不做静态分析：造一个账本，让**每个会进输出的自由文本字段**都带 ESC、BEL 与换行（标题、验收标准、
// Log、verify、assignee；resolution 是枚举，带不进去），再把 prime（默认 / --full，文本 / --json）与 handoff --check（文本 /
// --json）各跑一遍，逐字节找控制字符。文本里只允许换行；JSON 解码后的字符串里只允许换行与 Tab
// （多行 Log 的续行）。F11、F12 的评审四次在这里找到漏网的字段——判定者是输出本身，不是代码的形状。

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const cli = (dir, ...args) => execFileSync(process.execPath, [join(ROOT, "src/cli.ts"), "-C", dir, ...args],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

const E = "\x1b[31m", B = "\x07";
const dir = mkdtempSync(join(tmpdir(), "todopi-controls-"));
cli(dir, "init");
const id = (out) => JSON.parse(out).id;
const mine = id(cli(dir, "--as", "me@h", "--json", "add", `mine${E}`, "--ac", `ac${E}${B}`, "--verify", `v${E}\nsecond`));
cli(dir, "--as", "me@h", "prime", "--session", "s");
cli(dir, "--as", "me@h", "claim", mine);
cli(dir, "--as", "me@h", "note", mine, `note${E}\nline two${B}`);
const theirs = id(cli(dir, "--as", "me@h", "--json", "add", `theirs${E}`, "--verify", `w${E}`));
cli(dir, "--as", `bad${E}actor`, "claim", theirs);
const closed = id(cli(dir, "--as", "me@h", "--json", "add", `closed${E}`));
const p = join(dir, ".todopi", "tasks", `${closed}.md`);
writeFileSync(p, readFileSync(p, "utf8").replace(/^status: "open"$/m, `status: "closed"\nresolution: "done"`));
cli(dir, "--as", "me@h", "--json", "add", `ready${E}`);

const TEXT_BAD = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/;
const JSON_BAD = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;
const problems = [];
const strings = (v, out = []) => {
  if (typeof v === "string") out.push(v);
  else if (v !== null && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
};
for (const args of [["prime"], ["prime", "--full"], ["handoff", "--check", "--session", "s"]]) {
  const text = cli(dir, "--as", "me@h", ...args);
  if (TEXT_BAD.test(text)) problems.push(`${args.join(" ")}: 文本里有控制字符 ${JSON.stringify(text.match(TEXT_BAD)[0])}`);
  for (const s of strings(JSON.parse(cli(dir, "--as", "me@h", "--json", ...args)))) {
    if (JSON_BAD.test(s)) problems.push(`--json ${args.join(" ")}: 字段 ${JSON.stringify(s)} 里有控制字符`);
  }
}
// 夹具自检：带 ESC 的字段确实进了输出——否则上面的「没找到」证明不了什么。
const full = cli(dir, "--as", "me@h", "prime", "--full") + cli(dir, "--as", "me@h", "handoff", "--check", "--session", "s");
for (const needle of ["mine\\x1b", "ac\\x1b", "note\\x1b", "theirs\\x1b", "bad\\x1b", "closed\\x1b", "w\\x1b"]) {
  if (!full.includes(needle)) problems.push(`夹具没生效：输出里没有 ${needle}（字段没进输出，检查就是空转）`);
}
for (const x of problems) console.log(x);
