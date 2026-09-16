#!/usr/bin/env node
// tools/check-fixtures.mjs —— 校验 spec/fixtures/ 与格式规格自洽
//
// 语料库号称是「规格的可执行形式」，但只有真的被执行，这个说法才成立。
// 这个脚本是 src/ 出现之前 Layer 2 的唯一真实内容：它跑的是真实文件、
// 真实解析，不是静态检查。
//
// 零依赖：只用 node: 内置模块。frontmatter 解析用规范形态的扫描器——
// 这同时验证了「写入端一律加引号」使 frontmatter 成为一个可被简单扫描的
// 子语言（spec §5.1）这个论断。
//
// 与 tests/fixtures.test.ts 的分工：
//   本文件           —— 校验语料**本身**的质量：每个 .json 有 note、每条不变量都有
//                      样例、invalid 样例声明了违反哪条规则。语料是给第三方用的，
//                      质量由这里守，即使 src/ 还不存在也能跑。
//   fixtures.test.ts —— 校验 src/ 的**实现**对不对：解析结果与期望值一致、快路径与
//                      yaml 路径一致、invalid 样例被对应规则抓到。
// 两者测的不是一回事，都要留着。
//
// 退出码：0 全部通过 · 1 有失败

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FX = join(ROOT, "spec", "fixtures");

let failures = 0;
const fail = (where, msg) => { failures++; console.error(`  FAIL ${where}: ${msg}`); };

// ── 信封（spec §5.1）──────────────────────────────────────────────────────────
function splitEnvelope(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return null;
  return { head: text.slice(4, end), body: text.slice(end + 5) };
}

// ── 规范形态扫描器（spec §5.1：写入端一律加双引号）───────────────────────────
// 任何偏离规范形态的行返回 null，表示「这个文件需要完整的 YAML 解析器」。
function scanCanonical(head) {
  const out = {};
  for (const line of head.split("\n")) {
    if (line === "") continue;
    if (line[0] === " " || line[0] === "\t" || line[0] === "#") return null;
    const sep = line.indexOf(": ");
    if (sep < 1) return null;
    const key = line.slice(0, sep);
    if (!/^(x-)?[a-z][a-z0-9_.-]*$/.test(key)) return null;
    const raw = line.slice(sep + 2);

    if (raw[0] === "[") {
      if (raw[raw.length - 1] !== "]") return null;
      const inner = raw.slice(1, -1).trim();
      if (inner === "") { out[key] = []; continue; }
      const items = [];
      let i = 0;
      while (i < inner.length) {
        if (inner[i] !== '"') return null;
        const s = readQuoted(inner, i);
        if (!s) return null;
        items.push(s.value); i = s.next;
        if (i < inner.length) { if (inner.slice(i, i + 2) !== ", ") return null; i += 2; }
      }
      out[key] = items; continue;
    }
    if (raw[0] !== '"') return null;
    const s = readQuoted(raw, 0);
    if (!s || s.next !== raw.length) return null;
    out[key] = s.value;
  }
  return out;
}

function readQuoted(s, start) {
  if (s[start] !== '"') return null;
  let v = "", i = start + 1;
  while (i < s.length) {
    if (s[i] === "\\") {
      const n = s[i + 1];
      if (n === "\\" || n === '"') { v += n; i += 2; continue; }
      return null;                       // 未定义的转义
    }
    if (s[i] === '"') return { value: v, next: i + 1 };
    v += s[i]; i++;
  }
  return null;                           // 未闭合
}

// ── valid/ ───────────────────────────────────────────────────────────────────
function checkValid() {
  const dir = join(FX, "valid");
  const files = readdirSync(dir).filter(f => f.endsWith(".md")).sort();
  if (files.length === 0) { fail("valid/", "目录为空"); return 0; }

  for (const f of files) {
    const where = `valid/${f}`;
    const text = readFileSync(join(dir, f), "utf8");
    const jsonPath = join(dir, f.replace(/\.md$/, ".json"));
    if (!existsSync(jsonPath)) { fail(where, "缺少配套的 .json 期望值"); continue; }
    const expect = JSON.parse(readFileSync(jsonPath, "utf8"));

    if (!expect.note) fail(where, ".json 缺少 note —— 语料的价值在于说明它针对哪个错误");

    const env = splitEnvelope(text);
    if (!env) { fail(where, "信封解析失败：valid/ 下的文件必须是合法的 §5.1 信封"); continue; }
    if (!expect.frontmatter) continue;    // 断言别的东西（如 Log 语法），不在此校验

    const got = scanCanonical(env.head);
    if (got === null) {
      // 规范形态之外是允许的（人手写的文件），但必须自己声明
      if (expect.reader_must_accept !== true) {
        fail(where, "偏离规范形态，但 .json 未声明 reader_must_accept —— " +
                    "要么改成加引号形态，要么显式标注它测的是回退路径");
      }
      continue;
    }
    const a = JSON.stringify(got), b = JSON.stringify(expect.frontmatter);
    if (a !== b) fail(where, `扫描结果与期望不符\n    got: ${a}\n    exp: ${b}`);
  }
  return files.length;
}

// ── invalid/ ─────────────────────────────────────────────────────────────────
function checkInvalid() {
  const dir = join(FX, "invalid");
  const files = readdirSync(dir).filter(f => f.endsWith(".md")).sort();
  if (files.length === 0) { fail("invalid/", "目录为空"); return 0; }

  for (const f of files) {
    const where = `invalid/${f}`;
    const jsonPath = join(dir, f.replace(/\.md$/, ".json"));
    if (!existsSync(jsonPath)) { fail(where, "缺少配套的 .json"); continue; }
    const meta = JSON.parse(readFileSync(jsonPath, "utf8"));
    if (!meta.violates) fail(where, ".json 缺少 violates —— 必须点名它违反哪条规则");
    if (!meta.reason)   fail(where, ".json 缺少 reason");
  }
  return files.length;
}

// ── 交叉校验：规格里声明的不变量条数要和语料覆盖对得上 ────────────────────────
function checkInvariantCoverage() {
  const spec = readFileSync(join(ROOT, "spec", "todopi-format-v1.md"), "utf8");
  const section = spec.slice(spec.indexOf("### 6.2 Invariants"));
  const declared = (section.slice(0, section.indexOf("### 6.3")).match(/^\d+\. /gm) || []).length;
  const covered = new Set(
    readdirSync(join(FX, "invalid"))
      .filter(f => f.endsWith(".json"))
      .map(f => JSON.parse(readFileSync(join(FX, "invalid", f), "utf8")).violates)
      .filter(v => v && v.startsWith("invariant-")));
  console.log(`  规格声明不变量 ${declared} 条，语料覆盖 ${covered.size} 条`);
  for (let i = 1; i <= declared; i++) {
    if (!covered.has(`invariant-${i}`)) {
      fail("coverage", `不变量 ${i}（spec §6.2）没有对应的 invalid fixture`);
    }
  }
}

console.log("check-fixtures — spec/fixtures 与格式规格自洽");
const nv = checkValid();
const ni = checkInvalid();
checkInvariantCoverage();
console.log(`  valid ${nv} 个 · invalid ${ni} 个`);

if (failures > 0) {
  console.error(`\ncheck-fixtures: ${failures} 项失败`);
  process.exit(1);
}
console.log("check-fixtures: pass");
