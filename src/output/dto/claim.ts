// src/output/dto/claim.ts
// claim / release 的对外契约。--json 有版本承诺（FR-Q3）——改字段名要升 CLI 主版本。
//
// 本文件只搬字段，不算任何东西（ARCH-020）。

export type ClaimReport = {
  id: string;
  title: string;
  status: string;
  assignee: string;
  /** 被替换的 actor；没有替换任何人时缺省 */
  replaced?: string;
  /** 本次认领替换了别人的 assignee（spec §5.3.3 的 steal=true） */
  stolen: boolean;
  /** 本次只是刷新自己已持有的任务：没有迁移，也没有写 Log */
  refreshed: boolean;
};

export type ReleaseReport = {
  id: string;
  title: string;
  status: string;
};
