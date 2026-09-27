// @todopi/opencode: the same code `todopi setup` writes (src/format/opencode-plugin.ts). Needs the todopi CLI on PATH.
// Injects `todopi prime` output into the system prompt: refreshed when a session is created and after it is
// compacted, cached per session in between.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// Is there a .todopi/ at or above dir? Cheap check, so an empty result (no ledger yet) is retried only once one appears.
const hasLedger = (dir) => {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, ".todopi"))) return true;
    if (dirname(d) === d) return false;
  }
};

export const TodopiPlugin = async ({ $, directory }) => {
  // Loaded twice in the same moment (this file and the npm package, or two copies)? Only the first one injects; the other
  // returns no hooks: a copy that got an empty prime would retry and inject a second time on a later turn.
  // A load seconds later is a reload (pi's /reload, a session switch) and registers normally.
  // Monotonic clock: a wall clock set back after the first load would make every later reload look like a duplicate.
  const loadedAt = performance.now();
  if (globalThis.__todopiPrimeLoadedAt !== undefined && loadedAt - globalThis.__todopiPrimeLoadedAt < 5000) return {};
  globalThis.__todopiPrimeLoadedAt = loadedAt;
  const primed = new Map();
  // hook_event_name tells prime which occasion this is: a compaction right after the start is a new injection, not a duplicate.
  const prime = async (sessionID, hookEvent) => {
    const payload = Buffer.from(JSON.stringify({ sessionID, hook_event_name: hookEvent }));
    const r = await $`todopi --agent opencode prime --hook < ${payload}`.cwd(directory).quiet().nothrow();
    // Failed (e.g. todopi not on PATH yet): don't cache, so the next model call retries.
    if (r.exitCode === 0) primed.set(sessionID, r.stdout.toString().trim());
    else primed.delete(sessionID);
  };
  return {
    event: async ({ event }) => {
      if (event.type === "session.created") await prime(event.properties.info.id, "session.created");
      else if (event.type === "session.compacted") await prime(event.properties.sessionID, "session.compacted");
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) return;
      // Not primed yet, or primed empty (no ledger then) and a ledger has appeared since: prime now.
      if (!primed.has(input.sessionID) || (primed.get(input.sessionID) === "" && hasLedger(directory))) await prime(input.sessionID, "chat.system.transform");
      const text = primed.get(input.sessionID);
      if (text) output.system.push(text);
    },
  };
};
