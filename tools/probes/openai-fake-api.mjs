// tools/probes/openai-fake-api.mjs —— 在真实 OpenCode 运行时里看 todopi 插件的注入落在哪（tp-1ssqrw，D036）。
// 不是门禁：`/compact` 要交互式终端。它让实测可以照做一遍：
//
//   node tools/probes/openai-fake-api.mjs /tmp/req.log 18779 &
//   # 在一个装过 `todopi setup opencode`、有进行中任务的临时仓库里，opencode.json 加一个指向它的 provider：
//   #   { "provider": { "fake": { "npm": "@ai-sdk/openai-compatible", "options": { "baseURL": "http://127.0.0.1:18779/v1",
//   #     "apiKey": "fake" }, "models": { "echo": { "name": "echo" } } } }, "model": "fake/echo" }
//   opencode        # 说一句 → `todopi note <id> "MARKER-…"` → /compact → 再说一句，然后看 /tmp/req.log：
//   #   压缩前的请求：系统提示里有 prime 的 `## tp-…`，没有 MARKER（插件按会话缓存了会话开始时的 prime）
//   #   压缩后的第一个请求：系统提示里有 MARKER（session.compacted 让插件重跑了 prime）
//
// 每个请求体追加一行 JSON 到日志（带收到的时刻 `at`，顺序可以直接对上 todopi note 的时间）。回复是固定的一句——它不回显系统提示，
// 证据看请求体。按请求里的 stream 决定回 SSE 还是整段 JSON。只监听 127.0.0.1。usage 里的 prompt_tokens 固定是 50000：给模型配了
// limit.context 时可能触发自动压缩，实验时别配。

import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const [log, portText] = process.argv.slice(2);
if (log === undefined || portText === undefined) {
  process.stderr.write("usage: node tools/probes/openai-fake-api.mjs <request-log> <port>\n");
  process.exit(1);
}

const REPLY = "FAKE-REPLY: summary of the conversation so far.";
const usage = { prompt_tokens: 50000, completion_tokens: 12, total_tokens: 50012 };

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed;
    try { parsed = body === "" ? {} : JSON.parse(body); } catch { res.writeHead(400).end("bad json\n"); return; }
    appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), method: req.method, url: req.url, body: parsed })}\n`);
    if (req.url.endsWith("/models")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ object: "list", data: [{ id: "echo", object: "model", owned_by: "fake" }] }));
      return;
    }
    const id = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    if (parsed.stream === true) {
      res.setHeader("content-type", "text/event-stream");
      const chunk = (delta, finish, extra = {}) =>
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: parsed.model ?? "echo",
          choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
      res.write(chunk({ role: "assistant", content: REPLY }, null));
      res.write(chunk({}, "stop", { usage }));
      res.end("data: [DONE]\n\n");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id, object: "chat.completion", created, model: parsed.model ?? "echo",
      choices: [{ index: 0, message: { role: "assistant", content: REPLY }, finish_reason: "stop" }], usage }));
  });
}).listen(Number(portText), "127.0.0.1");
