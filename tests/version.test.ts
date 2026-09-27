import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../src/version.ts";

// src/version.ts 是版本号的运行时来源（单二进制里读不到 package.json，F21）；它必须与 package.json 一致。
test("VERSION 与 package.json 的 version 一致", () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as { version: string };
  assert.equal(VERSION, pkg.version);
});
