// tools/check-leaf-imports.mjs —— ARCH-025 的检查器：src/markdown/ 在运行时只能依赖 commonmark。
//
// **问 Node 自己的模块加载器，不用 grep、也不自己解析。** grep 版本连着两轮被评审绕过（缩进的 import、
// `export … from`、`import{join}from"node:path"`——都是合法语法）。这里在加载器的 resolve 钩子里记下
// 该目录的文件**实际**解析了哪些模块：只要运行时会加载的静态依赖，一个都漏不掉，因为判定者就是运行时本身。
//
// 动态的 `import(…)` / `require(…)` 只在执行到时才解析，钩子看不见；它们另用一条保守规则兜底——源码里
// 出现就报（宁可多报：注释里要提它们，换个说法即可）。
//
// 类型导入（`import type`）在类型剥离时就被删掉了，不产生运行时依赖，所以不报。

import { register } from "node:module";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { MessageChannel } from "node:worker_threads";

const ALLOWED = ["commonmark"];

export async function check(dir) {
  const root = pathToFileURL(realpathSync(resolvePath(dir))).href + "/";
  const { port1, port2 } = new MessageChannel();
  const seen = [];
  port1.on("message", (m) => seen.push(m));
  const hooks = `
    let port, root, allowed;
    export function initialize(d) { port = d.port; root = d.root; allowed = d.allowed; }
    export async function resolve(spec, ctx, next) {
      if (ctx.parentURL && ctx.parentURL.startsWith(root) && !allowed.includes(spec)) {
        port.postMessage({ parent: ctx.parentURL.slice(root.length), spec });
      }
      return next(spec, ctx);
    }`;
  register(`data:text/javascript,${encodeURIComponent(hooks)}`, {
    data: { port: port2, root, allowed: ALLOWED }, transferList: [port2],
  });

  const problems = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
    const src = readFileSync(join(dir, f), "utf8");
    if (/\bimport\s*\(|\brequire\s*\(/.test(src)) problems.push(`${f}: 出现了动态的 import(…) 或 require(…)`);
    try { await import(pathToFileURL(resolvePath(dir, f)).href); } catch { /* 解析失败也已经被钩子记下了 */ }
  }
  await new Promise((r) => setTimeout(r, 50));            // 让钩子线程的消息送达
  port1.close();
  for (const s of seen) problems.push(`${s.parent}: 依赖了 ${s.spec}`);
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const p of await check(process.argv[2] ?? "src/markdown")) {
    console.log(`${p} —— src/markdown/ 只能依赖 ${ALLOWED.join("、")}`);
  }
}
