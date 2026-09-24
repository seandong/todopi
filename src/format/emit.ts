// src/format/emit.ts
import YAML from "yaml";
import { generateKeyBetween } from "fractional-indexing";
import { EXIT, CliError } from "../exit.ts";

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
 *
 * 缓存有上限：键来自任务文件，一个导入器可能连着写进几万个互不相同的键，
 * 而缓存是模块级的（实测 2 万个 512 字符键会留下约 12 MB）。满了就不再新增，
 * 已缓存的照常命中——常见字段在最前面进来，正是最该留住的那些。
 * **满了绝不改变判断结果**，只是多跑一次解析器。
 */
const PLAIN_KEY_CACHE_LIMIT = 512;
const plainKeyCache = new Map<string, boolean>();

function plainKey(key: string): boolean {
  const cached = plainKeyCache.get(key);
  if (cached !== undefined) return cached;
  const ok = computePlainKey(key);
  if (plainKeyCache.size < PLAIN_KEY_CACHE_LIMIT) plainKeyCache.set(key, ok);
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
  const k = rankBetween(lastRank, null);
  if (k === null) {
    // 追加到末尾只有在最后一个 rank 已经是 32 个 z 这类极端值时才无解。
    throw new CliError(EXIT.usage,
      `The last task's rank ${JSON.stringify(lastRank)} leaves no room after it within 32 characters (spec §5.2). `
      + "Move it earlier, or renumber ranks with `todopi doctor --fix`.");
  }
  return k;
}

/** spec §5.2：`^[0-9a-z]{1,32}$`。 */
const MAX_RANK = 32;

/**
 * 两个 rank 之间的一个新 rank；null 表示那一侧没有边界。**真的无解时返回 null**，由调用方
 * 给出点名的拒绝。
 *
 * 三级，顺序有讲究：
 *
 * 1. **先用 fractional-indexing。** 它的键把「整数部分的长度」编进首字母，能在末尾追加极多次
 *    而长度几乎不涨——这是 add 天天走的路。
 * 2. **邻居不是库认识的形状、且是追加到末尾**：跳回库的键空间。spec 允许任何
 *    `[0-9a-z]{1,32}`，手写的 `rank: "a"` 规格合法、doctor 判为干净，库却抛
 *    `invalid order key: a`——add 与 move 曾在这样的合法账本上直接崩（F10 评审）。比 "a" 大的
 *    最小库键是 "b00"，之后的 add 又回到第 1 级。
 * 3. **其余情形用覆盖整个规格空间的中点。** 只在末尾追加时它的效率差（每一位只有几十个空位），
 *    所以它是最后一级，不是第一级。
 *
 * 无解只有两种：两者之间根本没有字符串（hi 恰好是 lo 后面补若干个 0，比如 "a" 与 "a0"；两个
 * rank 相同也算），或者能放进去的串都超过 32 个字符。spec §7.4 允许这时重编号，但那要改多个
 * 文件，而 FR-T5 要 move 只重写一个——所以交给调用方拒绝。
 */
export function rankBetween(lo: string | null, hi: string | null): string | null {
  try {
    const k = generateKeyBetween(lo, hi, RANK_ALPHABET);
    if (k.length <= MAX_RANK) return k;
  } catch {
    // 邻居不是库的形状，或者 lo >= hi。往下走，由后两级判断。
  }
  if (hi === null && lo !== null) {
    const k = libraryKeyAfter(lo);
    if (k !== null) return k;
  }
  const k = specBetween(lo ?? "", hi);
  return k !== null && k.length <= MAX_RANK ? k : null;
}

/**
 * 比 lo 大的、库认识的最短整数键：首字母比 lo 的首字母大，其后补该首字母要求的那么多个 0。
 *
 * **不写死键的形状，问库。** 我第一版按 base62 的直觉写了 "a0"、"b00"——而在本仓库的字母表
 * （数字在前）下，库的整数头以 "i" 为零点向两边变长，"b00" 根本不是它的键（实测）。
 */
function libraryKeyAfter(lo: string): string | null {
  for (let c = 97; c <= 122; c++) {                          // "a".."z"
    const header = String.fromCharCode(c);
    for (let n = 0; n < MAX_RANK; n++) {
      const k = header + "0".repeat(n);
      if (!isLibraryKey(k)) continue;
      // **按完整的键比较，不按首字符。** 第一版跳过了首字符不比 lo 大的头，于是从 "z" 出发找不到
      // 任何候选——而 "z" 加 18 个 0 就是一个比 "z" 大的库键（F10 第二轮评审）。
      if (k > lo) return k;
      break;                                                 // 这个头最小的键都不够大，换下一个头
    }
  }
  return null;
}

function isLibraryKey(k: string): boolean {
  try {
    generateKeyBetween(k, null, RANK_ALPHABET);
    return true;
  } catch {
    return false;
  }
}

const digit = (ch: string): number => RANK_ALPHABET.indexOf(ch);

/**
 * 规格空间上的中点：lo < k < hi，按码点比较（spec §7.4）。lo 为 "" 表示负无穷，hi 为 null 表示
 * 正无穷。逐位决定：首位不同且隔得开就取中间那一位；紧挨着就保留 lo 的首位、在它后面找一个比
 * lo 余下部分大的串；首位相同就递归。
 */
function specBetween(lo: string, hi: string | null): string | null {
  if (hi !== null && lo >= hi) return null;
  if (hi === null) {
    if (lo === "") return "i";
    const c = digit(lo[0]!);
    if (c < 35) return RANK_ALPHABET[Math.ceil((c + 36) / 2)]!;
    const rest = specBetween(lo.slice(1), null);
    return rest === null ? null : "z" + rest;
  }
  if (lo === "") {
    const h = digit(hi[0]!);
    if (h > 0) return RANK_ALPHABET[Math.floor(h / 2)]!;
    // hi 以 0 开头：只要 hi 不止一个字符，"0" 本身就比它小（前缀更短）。只有 hi === "0" 时，
    // 它之前才真的没有非空串。第一版在这里递归下去，于是 (null, "00") 明明有 "0" 却说无解
    // ——而属性测试的判据犯了同一个错（F10 第二轮评审）。
    return hi.length > 1 ? "0" : null;
  }
  const l = digit(lo[0]!);
  const h = digit(hi[0]!);
  if (l === h) {
    const rest = specBetween(lo.slice(1), hi.slice(1));
    return rest === null ? null : lo[0]! + rest;
  }
  if (h - l > 1) return RANK_ALPHABET[Math.floor((l + h) / 2)]!;
  const rest = specBetween(lo.slice(1), null);
  return rest === null ? null : lo[0]! + rest;
}
