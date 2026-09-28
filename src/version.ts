// src/version.ts
// CLI 的版本号。不在运行时读 package.json：Bun 编译的单二进制里没有这个文件（F21）。与 package.json 一致由
// tests/version.test.ts 钉住。

export const VERSION = "0.1.0";
