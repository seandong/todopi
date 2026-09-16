// src/format/scan.ts
// 规范形态扫描器。写入端一律给标量加双引号（spec §5.1），这让 frontmatter 成为
// 一个规则很窄的子语言：每个值要么是带引号的字符串，要么是带引号元素的 flow 列表。
//
// 返回 null 表示「这个文件偏离了规范形态，需要完整的 YAML 解析器」——它不是错误。
// 人手写的文件、第三方写的、后续版本写的都会走到这条回退路径。

export type ScannedValue = string | string[];
export type Scanned = Record<string, ScannedValue>;

const KEY = /^(x-)?[a-z][a-z0-9_.-]*$/;

export function scanCanonical(head: string): Scanned | null {
  const out: Scanned = {};
  for (const line of head.split("\n")) {
    if (line === "") continue;
    // 缩进行属于块结构，注释行同理——都不是规范形态
    if (line[0] === " " || line[0] === "\t" || line[0] === "#") return null;

    const sep = line.indexOf(": ");
    if (sep < 1) return null;
    const key = line.slice(0, sep);
    if (!KEY.test(key)) return null;
    if (key in out) return null;              // 重复键交给 yaml 去报 DUPLICATE_KEY
    const raw = line.slice(sep + 2);

    if (raw.startsWith("[")) {
      const list = scanFlowList(raw);
      if (list === null) return null;
      out[key] = list;
      continue;
    }
    const s = readQuoted(raw, 0);
    if (s === null || s.next !== raw.length) return null;
    out[key] = s.value;
  }
  return out;
}

function scanFlowList(raw: string): string[] | null {
  if (!raw.endsWith("]")) return null;
  const inner = raw.slice(1, -1);
  if (inner === "") return [];
  const items: string[] = [];
  let i = 0;
  while (i < inner.length) {
    const s = readQuoted(inner, i);
    if (s === null) return null;
    items.push(s.value);
    i = s.next;
    if (i === inner.length) break;
    if (inner.slice(i, i + 2) !== ", ") return null;
    i += 2;
  }
  return items;
}

type Read = { value: string; next: number };

/** 读一个双引号字符串。只认 \\ 与 \" 两种转义——其余一律回退给 yaml。 */
function readQuoted(s: string, start: number): Read | null {
  if (s[start] !== '"') return null;
  let value = "";
  let i = start + 1;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      const next = s[i + 1];
      if (next !== "\\" && next !== '"') return null;
      value += next;
      i += 2;
      continue;
    }
    if (ch === '"') return { value, next: i + 1 };
    value += ch;
    i++;
  }
  return null;                                 // 未闭合
}
