import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { PROTOCOL_BEGIN, PROTOCOL_END } from "../src/protocol.ts";

/**
 * README 里最容易悄悄过时的几条声明，与实现对着查（F28）：子命令个数、六家 setup 写的文件、需要信任的两家、协议段的标记、
 * Beads 原 id 的位置。措辞改了没关系，事实变了测试就红。
 */
const README = readFileSync(join(process.cwd(), "README.md"), "utf8");
const CLI = join(process.cwd(), "src", "cli.ts");

test("「all N subcommands」与 --help 列出的主命令个数一致（别名不算）", () => {
  const help = execFileSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
  const commands = help.slice(help.indexOf("Commands:")).split("\n").map((l) => /^ {2}([a-z]+)/.exec(l)?.[1])
    .filter((c): c is string => c !== undefined && c !== "help");
  // 纯别名的命令（描述以 alias for 开头）不算
  const aliases = new Set(help.split("\n").filter((l) => /alias for/.test(l)).map((l) => /^ {2}([a-z]+)/.exec(l)?.[1]));
  const primary = commands.filter((c) => !aliases.has(c));
  const n = Number(/lists all (\d+) subcommands/.exec(README)?.[1]);
  assert.equal(n, primary.length, `README says ${n}; --help has ${primary.length}: ${primary.join(" ")}`);
  assert.match(README, new RegExp(`${primary.length} subcommands`));
});

test("六家 setup 写的每个文件都在 README 那一家的小节里；Codex 与 pi 的信任提示也在", () => {
  const d = mkdtempSync(join(tmpdir(), "todopi-readme-"));
  const env = { ...process.env, HOME: mkdtempSync(join(tmpdir(), "todopi-readme-home-")) };
  execFileSync("git", ["init", "-q"], { cwd: d });
  execFileSync(process.execPath, [CLI, "-C", d, "init"], { env });
  const heading: Record<string, string> = {
    claude: "### Claude Code", codex: "### Codex CLI", opencode: "### OpenCode", pi: "### pi", cursor: "### Cursor", gemini: "### Gemini CLI",
  };
  for (const [agent, h] of Object.entries(heading)) {
    const start = README.indexOf(`${h}\n`);
    assert.ok(start >= 0, `README has no section ${h}`);
    const section = README.slice(start, README.indexOf("\n### ", start + 1) < 0 ? undefined : README.indexOf("\n### ", start + 1));
    assert.match(section, new RegExp(`todopi setup ${agent}\\b`));
    const r = spawnSync(process.execPath, [CLI, "-C", d, "--json", "setup", agent], { encoding: "utf8", env });
    const report = JSON.parse(r.stdout) as { files: { path: string }[]; notes: string[] };
    for (const f of report.files) {
      const rel = relative(d, f.path).split("\\").join("/");
      assert.ok(section.includes(`\`${rel}\``), `README's ${h} section does not mention ${rel}`);
    }
    // setup 提示了要信任什么，README 那一节就得说
    if (report.notes.some((n) => /trust/i.test(n))) assert.match(section, /trust/i, `${h}: setup asks for trust but README does not say so`);
  }
});

test("协议段的标记与 README 一致；Beads 原 id 的位置与导入器一致", () => {
  assert.ok(README.includes(PROTOCOL_BEGIN) && README.includes(PROTOCOL_END));
  const importer = readFileSync(join(process.cwd(), "src", "commands", "import-beads.ts"), "utf8");
  assert.match(importer, /external: \{ beads: \{ id: /);
  assert.match(README, /`external\.beads\.id`/);
});

test("--user：仍写进仓库的文件，README 讲 --user 的那段都点了名", () => {
  const d = mkdtempSync(join(tmpdir(), "todopi-readme-user-"));
  const home = mkdtempSync(join(tmpdir(), "todopi-readme-userhome-"));
  const env = { ...process.env, HOME: home };
  execFileSync("git", ["init", "-q"], { cwd: d });
  execFileSync(process.execPath, [CLI, "-C", d, "init"], { env });
  const para = README.split("\n\n").find((p) => p.includes("--user")) ?? "";
  const names: Record<string, string> = { "CLAUDE.md": "CLAUDE.md", ".cursor/rules/todopi.mdc": "rule file" };
  let inRepo = 0;
  for (const agent of ["claude", "codex", "opencode", "pi", "cursor", "gemini"]) {
    const r = spawnSync(process.execPath, [CLI, "-C", d, "--json", "setup", agent, "--user"], { encoding: "utf8", env });
    for (const f of (JSON.parse(r.stdout) as { files: { path: string }[] }).files) {
      const rel = relative(d, f.path).split("\\").join("/");
      if (rel.startsWith("..")) continue;
      inRepo++;
      assert.ok(rel in names && para.includes(names[rel]!), `setup ${agent} --user writes ${rel} in the repository; README's --user paragraph must say so`);
    }
  }
  assert.ok(inRepo > 0);
});
