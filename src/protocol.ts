// src/protocol.ts
// 每个 agent 收到的协议文本。三个消费者：init（写 AGENTS.md）、六家 setup
// （写各家的规则/技能文件）、文档站。它不属于任何一条命令，所以放在顶层。
//
// 这段文本是产品产物（PRD §9）：措辞靠 dogfooding 调整，改它不是代码变更。
// 它 MUST 是英文——会被写进用户的仓库，属于用户可见文案（DECISIONS D007）。
// 预算 800 token；当前实测 411（tiktoken o200k_base），留一半余量给措辞调整。

/** 段落标记。用 Markdown 注释，渲染时不可见，但让原地替换有确定的边界。 */
export const PROTOCOL_BEGIN = "<!-- todopi:protocol:begin -->";
export const PROTOCOL_END = "<!-- todopi:protocol:end -->";

export const PROTOCOL_TEXT = `## todopi

This repository keeps its durable task ledger in \`.todopi/\`. It outlives your context
window: tasks created in one session are found, with their history, by the next one —
after a compaction, on another machine, or under a different agent.

\`.todopi/\` is data. Never edit those files by hand; use the CLI.

**Granularity.** One todopi task is roughly one change worth a commit, with an outcome
somebody could check. Editing a file or running a test is a step, not a task. Keep using
your own todo list for the steps inside this turn, and never copy todopi tasks into it.

**Do these without deliberating:**

| When | Run |
|---|---|
| Starting work | Read the \`prime\` output you were given, or \`todopi prime\` |
| Before touching code | \`todopi claim <id>\` |
| You discover new work | \`todopi add "<title>" --from <current id>\` |
| You learned something the hard way | \`todopi note <id> "<what and why>"\` |
| The work is finished | \`todopi done <id>\` |
| Ending the session | \`todopi handoff\` |
| You notice your context was compacted | \`todopi prime\` — do not wait for a hook |

\`todopi done\` runs the task's verification command. If it fails, fix the work. Forcing past
it is for the case where the check itself is wrong, and it is recorded permanently.

**Queries.** \`todopi ls --ready\` for what to pick up next. \`todopi show <id>\` for one task's
detail. \`todopi prime --full\` when you need the whole picture. Add \`--json\` when parsing.

**Commits.** Include the \`.todopi/\` changes in the same commit as the work they describe,
and mention the task id in the message.
`;

/** 带标记的完整段落。写入与替换都用它，保证两侧边界一致。 */
export function protocolSection(): string {
  return `${PROTOCOL_BEGIN}\n\n${PROTOCOL_TEXT}\n${PROTOCOL_END}\n`;
}
