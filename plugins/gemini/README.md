# todopi for Gemini CLI

Hooks that inject your current [todopi](https://github.com/seandong/todopi) tasks into Gemini CLI: at session start, and on the next turn after `/compress`.

1. Install the todopi CLI so `todopi` is on your PATH (see the [todopi README](https://github.com/seandong/todopi#readme)).
2. `gemini extensions install https://github.com/seandong/todopi-gemini`

In a project with a `.todopi/` ledger, also run `todopi setup gemini` once (or add `AGENTS.md` to `context.fileName` in
`.gemini/settings.json`). That puts the todopi protocol in Gemini's system instruction, including "when you notice your context
was compacted, run `todopi prime`", which covers automatic compression; the hooks alone only cover `/compress`. Having both
the extension and `setup`'s hooks is fine: todopi injects once per session start.

This repository is generated from `plugins/gemini/` in https://github.com/seandong/todopi; change it there.
