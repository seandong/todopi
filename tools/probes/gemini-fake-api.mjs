// tools/probes/gemini-fake-api.mjs —— 在真实 Gemini CLI 运行时里看 todopi 的注入落在哪（D038、PRD §17 的 F17 实测）。
// 不是门禁：`/compress` 要交互式终端，没法无头跑。它让那次手工验证可以照做一遍：
//
//   node tools/probes/gemini-fake-api.mjs /tmp/req.log 18777 &
//   # 在一个装过 `todopi setup gemini`、有进行中任务的临时仓库里（HOME 指向临时目录，别碰你自己的 ~/.gemini）：
//   GEMINI_API_KEY=fake GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:18777 gemini
//   # 说一句 → /compress（应显示 compressed from 50000 to …）→ 再说两句，然后看 /tmp/req.log：
//   #   第一轮：`## tp-…` 是历史里一条独立的用户消息（SessionStart）；systemInstruction 含 AGENTS.md 的协议段
//   #   压缩后第一轮：那条消息被摘要替掉，`## tp-…` 追加在这一轮用户消息之后（BeforeAgent）
//   #   再下一轮：不再追加
//
// 每个请求体追加一行 JSON 到日志。回复是固定的；要 JSON 的请求（模型路由的分类器）回合法 JSON，否则它会退避重试。
// 报的 promptTokenCount 是 50000：太小的话 /compress 会判定「不划算」而不压缩。只监听 127.0.0.1。

import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const [log, portText] = process.argv.slice(2);
if (log === undefined || portText === undefined) {
  process.stderr.write("usage: node tools/probes/gemini-fake-api.mjs <request-log> <port>\n");
  process.exit(1);
}

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = body === "" ? {} : JSON.parse(body);
    appendFileSync(log, `${JSON.stringify({ url: req.url, body: parsed })}\n`);
    if (req.url.includes(":countTokens")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ totalTokens: 50000 }));
      return;
    }
    const wantsJson = parsed.generationConfig?.responseMimeType === "application/json";
    const text = wantsJson ? JSON.stringify({ reasoning: "fake", model_choice: "flash" }) : "FAKE-REPLY";
    const reply = {
      candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: 50000, candidatesTokenCount: 2, totalTokenCount: 50002 },
    };
    if (req.url.includes("alt=sse")) {
      res.setHeader("content-type", "text/event-stream");
      res.end(`data: ${JSON.stringify(reply)}\n\n`);
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(reply));
  });
}).listen(Number(portText), "127.0.0.1");
