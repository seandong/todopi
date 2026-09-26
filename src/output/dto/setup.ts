// src/output/dto/setup.ts
// setup 的对外契约：写了哪些文件、各自是新建 / 改了 / 没变（FR-A1：打印写入的每个文件）。

export type SetupReport = {
  agent: string;
  scope: "project" | "user";
  files: { path: string; status: "created" | "updated" | "appended" | "unchanged" }[];
  notes: string[];
};
