// src/format/emit.ts
import YAML from "yaml";
import { generateKeyBetween } from "fractional-indexing";

/** base36，与 spec §5.2 的 rank 正则 ^[0-9a-z]{1,32}$ 对齐。 */
const RANK_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** 字段顺序取自 spec §5.2 的表格。写入端按此发射，diff 才稳定。 */
const FIELD_ORDER = [
  "id", "title", "status", "resolution", "assignee", "parent",
  "blocked_by", "rank", "verify", "labels", "external", "created", "updated",
] as const;

export type NewTask = {
  id: string;
  title: string;
  status: string;
  rank: string;
  created: string;
  updated: string;
  parent?: string;
  blocked_by?: string[];
  verify?: string;
  labels?: string[];
  description?: string;
  acceptance?: string[];
  log: string[];
};

/**
 * 发射 frontmatter。**每个标量都加双引号**（spec §5.1）。
 *
 * 这条规则是 2026-09-15 那次规格评审的核心产出：不加引号时
 * `title: feat: add login` 让整个文件解析失败、`title: fix #42` 被静默截断成
 * "fix"、`rank: 007` 变成整数 7。而「一个任务≈一次提交」意味着标题按惯例带冒号，
 * 这是常态不是边界。加引号是消除歧义，而不是枚举它的情况。
 *
 * 未知键（包括 x-*）按 §5.2 必须被保留：它们排在已知字段之后，
 * 顺序保持调用方给的顺序。
 */
export function emitFrontmatter(fm: Record<string, unknown>): string {
  const lines: string[] = [];
  const known = new Set<string>(FIELD_ORDER);
  for (const key of FIELD_ORDER) if (key in fm) emitOne(lines, key, fm[key]);
  for (const key of Object.keys(fm)) if (!known.has(key)) emitOne(lines, key, fm[key]);
  return lines.join("\n") + "\n";
}

function emitOne(lines: string[], key: string, value: unknown): void {
  if (value === undefined) return;
  const c = plainKey(key) ? canonical(value) : null;
  if (c !== null) {
    lines.push(`${key}: ${c}`);
    return;
  }
  // 规范形态表达不了这个值，交给 YAML。
  //
  // 判据不是「是不是嵌套」，而是**规范形态能不能一字不差地把它写出去再读回来**。
  // §5.1 只定义了 \\ 与 \" 两种转义，所以含换行的字符串根本没法用它表达；
  // 而给数字加引号会让 x-count: 5 读回来变成字符串 "5"，那不叫「保留写者不认识
  // 的条目」（§5.2 字段 11）。第一版用 String(v) 强转，实测把 [{"k":"v"}] 写成
  // ["[object Object]"]、把含换行的值写成读不回来的文件——是数据损坏。
  lines.push(yamlEntry(key, value).trimEnd());
}

/**
 * 键能不能直接拼在 `key: value` 左边。
 *
 * **判据是「用真 YAML 解析器读回来还是不是同一个键」**，不是字符形状。
 * 字符形状安全不等于 YAML 语义安全：`null:` 读回来是空字符串键、`True:` 读回来
 * 是布尔 true、1100 字符的隐式键让标准解析器直接报错（YAML 的 `:` 指示符最多
 * 1024 字符）。这三种我在第一版都放行了。
 *
 * 更要命的是这些差异**只在整份回退到 yaml 解析时才显形**：scan.ts 的快路径把
 * 键当字面字符串，于是同一个文件在两条解析路径下含义不同。§5.1 要求读者把
 * 手写文件当合法 YAML 读，所以我们写出去的东西对两条路径必须是同一个意思。
 *
 * 不列保留字清单——那张清单我列不全，而且会随 yaml 版本漂。直接问解析器，
 * 结果按键缓存（同一批任务里键是高度重复的）。
 */
const plainKeyCache = new Map<string, boolean>();

function plainKey(key: string): boolean {
  const cached = plainKeyCache.get(key);
  if (cached !== undefined) return cached;
  const ok = computePlainKey(key);
  plainKeyCache.set(key, ok);
  return ok;
}

function computePlainKey(key: string): boolean {
  // 便宜的预筛：形状不对的直接否掉，不必进解析器
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) return false;
  try {
    const parsed: unknown = YAML.parse(`${key}: 0`);
    if (typeof parsed !== "object" || parsed === null) return false;
    const keys = Object.keys(parsed as Record<string, unknown>);
    return keys.length === 1 && keys[0] === key;
  } catch {
    return false;                      // 解析器都读不了，肯定不能手写
  }
}

/**
 * 能用 §5.1 规范形态表达就返回那串文本，否则返回 null。
 *
 * 规范形态覆盖的恰好是：不含控制字符的字符串，以及这种字符串的 flow 列表。
 * 「每个值都是一个带引号的字符串或一列带引号的字符串」是 §5.1 的原话，
 * 也正是 scan.ts 快路径认的那个子语言。
 */
function canonical(value: unknown): string | null {
  if (typeof value === "string") return quotable(value) ? quote(value) : null;
  if (Array.isArray(value)) {
    if (!value.every((v) => typeof v === "string" && quotable(v))) return null;
    return `[${value.map((v) => quote(v as string)).join(", ")}]`;
  }
  return null;
}

/** 控制字符没法只靠 §5.1 定义的那两种转义写出来。 */
function quotable(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return false;
  }
  return true;
}

/**
 * 用 YAML 发射一个键值对，形态尽量贴近 §5.1：键用 plain、标量双引号、
 * **列表用 flow 风格**（§5.1 明文要求列表是 flow style）。数字与布尔保持原样——
 * 给它们加引号会改变读回来的类型。
 */
function yamlEntry(key: string, value: unknown): string {
  const doc = new YAML.Document({ [key]: value });
  YAML.visit(doc, { Seq(_key, node) { node.flow = true; } });
  // defaultKeyType: "PLAIN" 是**偏好**不是强制：yaml 自己会判断一个键能不能 plain，
  // 不能就加引号（实测 "#meta" / "x-a: b" / "- dash" / "" 都被正确引起来）。
  // 所以安全的键保持 plain（与 spec 的 external fixture 一致），
  // 不安全的键由它加引号，两头都对。
  return doc.toString({ defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN", lineWidth: 0 });
}

/**
 * 只转义 \ 与 " —— 与 format/scan.ts 的快路径认得的两种转义严格对应。
 * 顺序要紧：先替换反斜杠再替换引号，反过来会把刚插入的反斜杠再转义一次。
 */
function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** 发射一个完整的任务文件。正文小节按 spec §5.3 的顺序，空的不发射。 */
export function emitTask(t: NewTask): string {
  const fm: Record<string, unknown> = {
    id: t.id, title: t.title, status: t.status, parent: t.parent,
    blocked_by: t.blocked_by && t.blocked_by.length > 0 ? t.blocked_by : undefined,
    rank: t.rank, verify: t.verify,
    labels: t.labels && t.labels.length > 0 ? t.labels : undefined,
    created: t.created, updated: t.updated,
  };
  const parts = ["---", emitFrontmatter(fm).trimEnd(), "---", ""];
  if (t.description) parts.push("## Description", "", t.description, "");
  if (t.acceptance && t.acceptance.length > 0) {
    parts.push("## Acceptance Criteria", "", ...t.acceptance.map((a) => `- [ ] ${a}`), "");
  }
  parts.push("## Log", "", ...t.log.map((l) => `- ${l}`), "");
  return parts.join("\n");
}

/**
 * 下一个 rank：追加到末尾。
 *
 * spec §7.4 与 FR-T1：创建时就分配 rank，使「有 rank」与「无 rank」的混合种群
 * 在正常路径下不存在——否则 `move X --after Y`（Y 无 rank）在规范内无解。
 * 在两个键之间插入是 move 的事（F10），本 feature 用不到。
 */
export function nextRank(lastRank: string | null): string {
  return generateKeyBetween(lastRank, null, RANK_ALPHABET);
}
