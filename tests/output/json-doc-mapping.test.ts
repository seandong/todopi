import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * docs/json.md 的「哪个命令印哪份报告」一表（F27）。ARCH-028 只核对类型本身；命令印的是不是表里说的那一份，得真的跑一遍：
 * 每个命令的 --json 顶层键，必须包含文档那一节的全部必有字段，且不出现文档之外的字段。
 */
const CLI = join(process.cwd(), "src", "cli.ts");
const DOC = readFileSync(join(process.cwd(), "docs", "json.md"), "utf8");

/** 文档里一节表格的字段：必有与可选（`(all of X)` 行展开成 X 的字段）。ts 块的小节不在这里用。 */
function fieldsOf(name: string): { required: Set<string>; optional: Set<string> } {
  const start = DOC.indexOf(`### \`${name}\`\n`);
  assert.ok(start >= 0, `docs/json.md has no section ${name}`);
  const end = DOC.indexOf("\n### ", start + 1);
  const required = new Set<string>();
  const optional = new Set<string>();
  for (const line of DOC.slice(start, end < 0 ? undefined : end).split("\n")) {
    const base = /^\| \(all of `(\w+)`\)/.exec(line);
    if (base !== null) {
      const b = fieldsOf(base[1]!);
      b.required.forEach((f) => required.add(f));
      b.optional.forEach((f) => optional.add(f));
      continue;
    }
    const m = /^\| `(\w+)(\?)?` \| `/.exec(line);
    if (m !== null) (m[2] === "?" ? optional : required).add(m[1]!);
  }
  return { required, optional };
}

function assertShape(name: string, value: unknown): void {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${name}: not an object: ${JSON.stringify(value)}`);
  const { required, optional } = fieldsOf(name);
  const keys = Object.keys(value);
  for (const f of required) assert.ok(keys.includes(f), `${name}: missing ${f} in ${JSON.stringify(value)}`);
  for (const k of keys) assert.ok(required.has(k) || optional.has(k), `${name}: ${k} is not in docs/json.md`);
}

function setup() {
  const d = mkdtempSync(join(tmpdir(), "todopi-jsondoc-"));
  const cfg = mkdtempSync(join(tmpdir(), "todopi-jsondoc-cfg-"));
  const env: NodeJS.ProcessEnv = { ...process.env, TODOPI_CONFIG_DIR: cfg, HOME: cfg };
  for (const k of ["CI", "CLAUDECODE", "CODEX_THREAD_ID", "GEMINI_CLI", "OPENCODE", "PI_SESSION_ID", "CURSOR_AGENT", "TODOPI_AGENT", "TODOPI_ACTOR"]) delete env[k];
  execFileSync("git", ["init", "-q"], { cwd: d });
  execFileSync("git", ["config", "user.name", "tester"], { cwd: d });
  /** 跑一条命令，返回 stdout 解析出的 JSON 与退出码 */
  const json = (...args: string[]) => {
    const r = spawnSync(process.execPath, [CLI, "-C", d, "--json", ...args], { encoding: "utf8", env });
    let value: unknown;
    try { value = JSON.parse(r.stdout); } catch { assert.fail(`${args.join(" ")}: stdout is not JSON (exit ${r.status}): ${r.stdout}${r.stderr}`); }
    return { value, code: r.status };
  };
  return { d, json };
}

test("每个命令印的是 docs/json.md 表里说的那一份报告", () => {
  const { d, json } = setup();
  assertShape("InitReport", json("init").value);
  const add = json("add", "one", "--ac", "first", "--verify", "exit 0").value as { id: string };
  assertShape("AddReport", add);
  const other = (json("add", "two").value as { id: string }).id;
  const ls = json("ls").value;
  assert.ok(Array.isArray(ls) && ls.length === 2);
  for (const t of ls) assertShape("TaskDto", t);
  assertShape("ShowDto", json("show", add.id, "--tree").value);
  assertShape("ClaimReport", json("claim", add.id).value);
  assertShape("NoteReport", json("note", add.id, "hello").value);
  assertShape("EditReport", json("edit", add.id, "--plan", "p").value);
  assertShape("MoveReport", json("move", other, "--top").value);
  assertShape("DepReport", json("dep", "add", other, "--on", add.id).value);
  assertShape("PrimeReport", json("prime").value);
  assertShape("PrimeFullReport", json("prime", "--full").value);
  assertShape("HandoffReport", json("handoff", "--check").value);
  // done 被验收标准挡住：GateReport，退出 2
  const refused = json("done", add.id, "--yes");
  assert.equal(refused.code, 2);
  assertShape("GateReport", refused.value);
  for (const a of (refused.value as { actions: unknown[] }).actions) assertShape("GateAction", a);
  assertShape("CheckReport", json("check", add.id, "1").value);
  assertShape("TransitionReport", json("done", add.id, "--yes").value);
  assertShape("TransitionReport", json("reopen", add.id).value);
  json("claim", other);
  assertShape("ReleaseReport", json("release", other).value);
  assertShape("TransitionReport", json("close", other, "--resolution", "obsolete").value);
  writeFileSync(join(d, "plan.md"), "- [ ] imported\n");
  assertShape("ImportReport", json("import", join(d, "plan.md")).value);
  mkdirSync(join(d, ".beads"));
  writeFileSync(join(d, ".beads", "issues.jsonl"),
    `${JSON.stringify({ id: "bd-1", title: "from beads", status: "open", priority: 2, issue_type: "task", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" })}\n`);
  assertShape("ImportBeadsReport", json("import", "beads").value);
  assertShape("SetupReport", json("setup", "codex").value);
  const doctor = json("doctor").value;
  assertShape("DoctorReport", doctor);
  const fix = json("doctor", "--fix").value as { after: unknown };
  assertShape("DoctorFixReport", fix);
  assertShape("DoctorReport", fix.after);
});
