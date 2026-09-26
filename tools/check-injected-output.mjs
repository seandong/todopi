// tools/check-injected-output.mjs —— ARCH-026 / ARCH-027 的检查器：prime 与 handoff 的输出。
//
//   node tools/check-injected-output.mjs commands   # ARCH-026：文本里的内容都在 JSON 里
//   node tools/check-injected-output.mjs controls   # ARCH-027：没有原始控制字符，单行字段没有换行
//
// **检查输出本身，不检查代码的形状。** 第一版 ARCH-026 是一条 grep（渲染层里不许出现 `todopi ` 字面量），
// 评审用 `["todopi","show"].join(" ")` 就绕过去了；第一版 ARCH-027 允许 JSON 字符串里有换行、也没跑
// 不带 --check 的 handoff，多行 verify 伪造出的任务行它看不见（F12 评审六轮）。「check 比措辞窄」的第十次。
//
// 做法：造一个账本，让每个会进输出的自由文本字段都带 ESC、BEL、换行（多行 verify 里藏一行伪造的任务），
// 把 prime（默认、--full）与 handoff（--check、真的写）各跑文本与 --json 两遍：
//   - commands：文本里每个 `todopi <子命令> …` 都原样出现在 JSON 的某个字符串里；文本里每一行
//     `- tp-…` / `## tp-…` 开头的 id 都是 JSON 里某个 `id` 字段的值（伪造的任务行过不了这一条）。
//   - controls：文本里除换行外没有控制字符；JSON 解码后的字符串里没有控制字符，且只有 `log` 条目
//     可以含换行（多行 Log 的续行），其余字段都是单行。
// 并自检：带控制字符的字段确实进了输出——否则「没找到」证明不了什么。

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mode = process.argv[2];
if (mode !== "commands" && mode !== "controls") { console.log("usage: check-injected-output.mjs commands|controls"); process.exit(0); }

const ROOT = join(import.meta.dirname, "..");
const cli = (dir, ...args) => {
  try {
    return execFileSync(process.execPath, [join(ROOT, "src/cli.ts"), "-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) { return e.stdout ?? ""; }    // handoff 有写失败时非零退出，输出照样要查
};

const E = "\x1b[31m", B = "\x07";
const base = mkdtempSync(join(tmpdir(), "todopi-injected-"));
cli(base, "init");
const id = (out) => JSON.parse(out).id;
const mine = id(cli(base, "--as", "me@h", "--json", "add", `mine${E}`, "--ac", `ac${E}${B}`, "--verify", "v"));
cli(base, "--as", "me@h", "prime", "--session", "s");
cli(base, "--as", "me@h", "claim", mine);
cli(base, "--as", "me@h", "note", mine, `note${E}\nline two${B}`);
cli(base, "--as", "me@h", "edit", mine, "--verify", `v2${E}\n- tp-aaaaaa forged: evil`);
const prose = id(cli(base, "--as", "me@h", "--json", "add", `prose${E}`));
cli(base, "--as", "me@h", "claim", prose);
const theirs = id(cli(base, "--as", "me@h", "--json", "add", `theirs${E}`, "--verify", `w${E}`));
cli(base, "--as", `bad${E}actor`, "claim", theirs);
const closed = id(cli(base, "--as", "me@h", "--json", "add", `closed${E}`));
const p = join(base, ".todopi", "tasks", `${closed}.md`);
writeFileSync(p, readFileSync(p, "utf8").replace(/^status: "open"$/m, 'status: "closed"\nresolution: "done"'));
for (let k = 0; k < 6; k++) cli(base, "--as", "me@h", "add", `ready${k}${E}`);

// 每种形态在账本的一份拷贝上跑，文本与 JSON 看到的是同一个状态（真的 handoff 会写）。
const FORMS = [["prime"], ["prime", "--full"], ["handoff", "--check", "--session", "s"], ["handoff", "--session", "s"]];
const runs = FORMS.map((args) => {
  const a = mkdtempSync(join(tmpdir(), "todopi-injected-")), b = mkdtempSync(join(tmpdir(), "todopi-injected-"));
  cpSync(base, a, { recursive: true }); cpSync(base, b, { recursive: true });
  return { name: args.join(" "), text: cli(a, "--as", "me@h", ...args), json: JSON.parse(cli(b, "--as", "me@h", "--json", ...args)) };
});

const strings = (v, key = "", out = []) => {
  if (typeof v === "string") out.push({ key, s: v });
  else if (Array.isArray(v)) for (const x of v) strings(x, key, out);
  else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) strings(x, k, out);
  return out;
};
const ids = (v, out = new Set()) => {
  if (Array.isArray(v)) for (const x of v) ids(x, out);
  else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (k === "id" && typeof x === "string") out.add(x); else ids(x, out); }
  return out;
};

const problems = [];
for (const r of runs) {
  const all = strings(r.json);
  if (mode === "commands") {
    // 连同紧跟的那个字符一起比：`todopi show` 是 JSON 里 `todopi show tp-x` 的子串，只比命令本身会放过
    // 渲染层现拼的一条不完整命令。
    for (const m of r.text.matchAll(/todopi [a-z][a-z-]*(?: (?:--?[a-z-]+|tp-[0-9a-z]+|<[^>]*>))*/g)) {
      const cmd = m[0], next = r.text[m.index + cmd.length] ?? "";
      if (!all.some(({ s }) => s === cmd || s.includes(cmd + next))) problems.push(`${r.name}: 文本里的「${cmd}」不在 JSON 里`);
    }
    const known = ids(r.json);
    for (const [, tid] of r.text.matchAll(/^(?:- |## )(tp-[0-9a-z]+)\b/gm)) {
      if (!known.has(tid)) problems.push(`${r.name}: 文本里有一行任务 ${tid}，JSON 里没有这个 id（伪造的行？）`);
    }
  } else {
    const m = r.text.match(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
    if (m) problems.push(`${r.name}: 文本里有控制字符 ${JSON.stringify(m[0])}`);
    for (const { key, s } of all) {
      const c = s.match(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
      if (c) problems.push(`--json ${r.name}: ${key} 字段里有控制字符 ${JSON.stringify(c[0])}`);
      if (key !== "log" && /[\n\t]/.test(s)) problems.push(`--json ${r.name}: 单行字段 ${key} 里有换行或 Tab：${JSON.stringify(s)}`);
    }
  }
}
// 夹具自检：带控制字符的字段、多行 verify、handoff 的写入结果，确实进了输出。
const text = runs.map((r) => r.text).join("\n");
for (const needle of ["mine\\x1b", "ac\\x1b", "note\\x1b", "theirs\\x1b", "bad\\x1b", "closed\\x1b", "forged", "Logged handoff:", `todopi show ${prose}`]) {
  if (!text.includes(needle)) problems.push(`夹具没生效：输出里没有 ${needle}（检查就是空转）`);
}
for (const x of problems) console.log(x);
