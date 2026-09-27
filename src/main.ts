#!/usr/bin/env node
// src/main.ts
// 安装后的入口（npm 包的 bin、Bun 编译单二进制的入口）。
//
// verify 的 runner 要以独立进程运行（exec/runner.ts 头部写了为什么）。npm 包里它是磁盘上的一个 .js 文件，run.ts 直接用 node
// 跑它；单二进制里没有这个文件，run.ts 就把二进制自己再起一次、用 RUNNER_ENV 带上参数——这里据此只加载 runner 模块（它在
// 模块顶层就开始干活），不进命令解析（F21）。

import { RUNNER_ENV } from "./exec/run.ts";

if (process.env[RUNNER_ENV] !== undefined) await import("./exec/runner.ts");
else await import("./cli.ts");
