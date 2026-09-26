// src/output/render/setup.ts

import type { SetupReport } from "../dto/setup.ts";

export function renderSetup(r: SetupReport): string {
  const lines = r.files.map((f) => `${f.status.padEnd(9)} ${f.path}`);
  for (const n of r.notes) lines.push(n);
  return `${lines.join("\n")}\n`;
}
