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
//   - commands：文本里每一段以 `todopi` 起头、到反引号 / 右括号 / 换行为止的文字（空白规范化之后），
//     连同那个分隔符都出现在 JSON 的某个字符串里；文本里
//     每一行 `- tp-…` / `## tp-…` 的 id 都是 JSON 里的 id，紧跟着的是 JSON 里这个 id 的标题，且行数不多于
//     JSON 里这个 id 的对象数。
//   **它不证明**文本是 DTO 的纯函数：渲染层自己拼出的普通文字（标签、标点）它不核对——那靠「渲染只
//   引用 DTO 字段」的约定与用例。规则措辞只宣称上面这些（F12 评审七轮：措辞宽于检查，第十一次）。
//   - controls：文本里除换行外没有看不见的字符（控制、格式——零宽与双向文字——、默认不可见、非普通空白，F35）；
//     JSON 解码后的字符串里也没有，且只有 `log` 条目可以含换行（多行 Log 的续行），其余字段都是单行。
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

// ESC、BEL 是控制字符；Z（零宽空格）与 R（从右到左覆盖）是格式字符——终端上看不见，却能藏住或倒转文字（F35）
const E = "\x1b[31m", B = "\x07", Z = "\u200b", R = "\u202e";
const base = mkdtempSync(join(tmpdir(), "todopi-injected-"));
cli(base, "init");
const id = (out) => JSON.parse(out).id;
const mine = id(cli(base, "--as", "me@h", "--json", "add", `mine${E}${Z}`, "--ac", `ac${E}${B}${R}`, "--verify", "v"));
cli(base, "--as", "me@h", "prime", "--session", "s");
cli(base, "--as", "me@h", "claim", mine);
cli(base, "--as", "me@h", "note", mine, `note${E}\nline two${B}${Z}`);
cli(base, "--as", "me@h", "edit", mine, "--verify", `v2${E}\n- tp-aaaaaa forged: evil`);
const prose = id(cli(base, "--as", "me@h", "--json", "add", `prose${E}`));
cli(base, "--as", "me@h", "claim", prose);
const theirs = id(cli(base, "--as", "me@h", "--json", "add", `theirs${E}${R}`, "--verify", `w${E}${Z}`));
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
/** JSON 里每个带 id 的对象：id → 它们的 title 列表（同一个 id 可以出现在几节里）。 */
const refs = (v, out = new Map()) => {
  if (Array.isArray(v)) for (const x of v) refs(x, out);
  else if (v !== null && typeof v === "object") {
    if (typeof v.id === "string") out.set(v.id, [...(out.get(v.id) ?? []), typeof v.title === "string" ? v.title : ""]);
    for (const x of Object.values(v)) refs(x, out);
  }
  return out;
};
const squash = (s) => s.replace(/[ \t]+/g, " ");

const problems = [];
for (const r of runs) {
  const all = strings(r.json);
  if (mode === "commands") {
    // **不猜命令的语法**：从 `todopi` 起，一直取到下一个反引号、右括号或换行（或文末），整段连同那个
    // 分隔符都要出现在 JSON 的某个字符串里。前两版按「`todopi` + 子命令 + 选项」的形状去认，先后被
    // 两个空格（评审七轮）与前置的全局选项 `todopi --json show …`（评审八轮）绕过——又一次用字符形状
    // 近似一个需要真解析的判断。空白先规范化（`todopi  show` 在 shell 里就是 `todopi show`）。
    const text = squash(r.text), json = all.map(({ s }) => squash(s));
    for (const m of text.matchAll(/\btodopi[ \t][^`)\n]*/g)) {
      const cmd = m[0].trimEnd(), next = text[m.index + m[0].length] ?? "";
      if (!json.some((s) => s === cmd || s.includes(m[0] + next))) problems.push(`${r.name}: 文本里的「${cmd}」不在 JSON 里`);
    }
    // 任务行：id 后面紧跟的必须是 JSON 里这个 id 的标题；同一个 id 的行数不能多于 JSON 里的对象数
    // （评审七轮：借一个真 id 就能伪造出标题任意的一行）。
    const known = refs(r.json), seen = new Map();
    for (const [, tid, rest] of r.text.matchAll(/^(?:- |## )(tp-[0-9a-z]+):? ?(.*)$/gm)) {
      const titles = known.get(tid);
      if (titles === undefined) { problems.push(`${r.name}: 文本里有一行任务 ${tid}，JSON 里没有这个 id（伪造的行？）`); continue; }
      if (!titles.some((t) => rest.startsWith(t))) problems.push(`${r.name}: 任务行「${tid} ${rest}」的标题不是 JSON 里的标题`);
      seen.set(tid, (seen.get(tid) ?? 0) + 1);
    }
    for (const [tid, n] of seen) if (n > known.get(tid).length) problems.push(`${r.name}: 任务 ${tid} 在文本里出现 ${n} 行，JSON 里只有 ${known.get(tid).length} 处`);
  } else {
    // 按 Unicode 类别认「看不见的字符」：控制、格式（零宽、双向文字）、行 / 段分隔符、默认不可见码位、普通空格以外的空白
    // （与 domain/visible.ts 同一个判据）。文本里只许有换行，JSON 里只许 log 带换行 / Tab
    const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]|(?! )\p{Zs}/u;
    const m = r.text.replace(/\n/g, "").match(HIDDEN);
    if (m) problems.push(`${r.name}: 文本里有看不见的字符 ${JSON.stringify(m[0])}`);
    for (const { key, s } of all) {
      const c = (key === "log" ? s.replace(/[\n\t]/g, "") : s).match(HIDDEN);
      if (c) problems.push(`--json ${r.name}: ${key} 字段里有看不见的字符 ${JSON.stringify(c[0])}`);
      if (key !== "log" && /[\n\t]/.test(s)) problems.push(`--json ${r.name}: 单行字段 ${key} 里有换行或 Tab：${JSON.stringify(s)}`);
    }
  }
}
// 夹具自检：带控制字符的字段、多行 verify、handoff 的写入结果，确实进了输出。
const text = runs.map((r) => r.text).join("\n");
for (const needle of ["mine\\x1b", "ac\\x1b", "note\\x1b", "theirs\\x1b", "bad\\x1b", "closed\\x1b", "forged", "Logged handoff:", `todopi show ${prose}`,
  "\\u200b", "\\u202e"]) {
  if (!text.includes(needle)) problems.push(`夹具没生效：输出里没有 ${needle}（检查就是空转）`);
}
for (const x of problems) console.log(x);
