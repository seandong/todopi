// src/commands/close.ts
import { RESOLUTIONS } from "../domain/types.ts";
import { runTransition, logLine, type TransitionOptions } from "./transition.ts";
import { EXIT, CliError } from "../exit.ts";
import type { TransitionReport } from "../output/dto/gate.ts";

export type CloseOptions = Omit<TransitionOptions, "transition"> & { resolution?: string };

/** spec §5.2 字段 4 的取值，减去 `done`——那是 `done` 命令的事（§6.1 两行分开写）。 */
const CLOSE_RESOLUTIONS = RESOLUTIONS.filter((r) => r !== "done");

export function runClose(opts: CloseOptions): TransitionReport {
  const resolution = opts.resolution;
  if (resolution === undefined || resolution === "") {
    throw new CliError(EXIT.usage,
      `close needs --resolution <${CLOSE_RESOLUTIONS.join("|")}>. ` +
      "Use `todopi done` when the work is actually finished.");
  }
  if (!(CLOSE_RESOLUTIONS as readonly string[]).includes(resolution)) {
    throw new CliError(EXIT.usage,
      `--resolution must be one of ${CLOSE_RESOLUTIONS.join(" / ")}; got ${JSON.stringify(resolution)}. ` +
      "Use `todopi done` for work that was finished.");
  }

  return runTransition({ ...opts, transition: "close" }, {
    frontmatter: (fm) => ({ ...fm, status: "closed", resolution }),
    logLine: (ctx) => logLine("closed", [["resolution", resolution]], ctx),
    dropLease: true,
  });
}
