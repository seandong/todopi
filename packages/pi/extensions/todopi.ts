// @todopi/pi: the same code `todopi setup` writes (src/format/pi-extension.ts). Needs the todopi CLI on PATH.
// Injects `todopi prime` output into the system prompt: refreshed on session start and after compaction,
// cached per session in between.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// Is there a .todopi/ at or above dir? Cheap check, so an empty result (no ledger yet) is retried only once one appears.
const hasLedger = (dir) => {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, ".todopi"))) return true;
    if (dirname(d) === d) return false;
  }
};

export default function (pi) {
  // Loaded twice in the same moment (this file and the npm package, or two copies)? Only the first one injects; the other
  // registers nothing: a copy that got an empty prime would retry and inject a second time on a later turn.
  // A load seconds later is a reload (pi's /reload, a session switch) and registers normally.
  // Monotonic clock: a wall clock set back after the first load would make every later reload look like a duplicate.
  const loadedAt = performance.now();
  if (globalThis.__todopiPrimeLoadedAt !== undefined && loadedAt - globalThis.__todopiPrimeLoadedAt < 5000) return;
  globalThis.__todopiPrimeLoadedAt = loadedAt;
  const primed = new Map();
  // The event name tells prime which occasion this is: a compaction right after the start is a new injection, not a duplicate.
  const prime = async (ctx, hookEvent) => {
    const id = ctx.sessionManager.getSessionId();
    const r = await pi.exec("todopi", ["--agent", "pi", "prime", "--hook", "--session", id, "--hook-event", hookEvent], { cwd: ctx.cwd, timeout: 30000 });
    // Failed (e.g. todopi not on PATH yet): don't cache, so the next turn retries.
    if (r.code === 0) primed.set(id, r.stdout.trim());
    else primed.delete(id);
  };
  pi.on("session_start", async (_event, ctx) => { await prime(ctx, "session_start"); });
  pi.on("session_compact", async (_event, ctx) => { await prime(ctx, "session_compact"); });
  pi.on("before_agent_start", async (event, ctx) => {
    const id = ctx.sessionManager.getSessionId();
    // Not primed yet, or primed empty (no ledger then) and a ledger has appeared since: prime now.
    if (!primed.has(id) || (primed.get(id) === "" && hasLedger(ctx.cwd))) await prime(ctx, "before_agent_start");
    const text = primed.get(id);
    if (!text) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${text}` };
  });
}
