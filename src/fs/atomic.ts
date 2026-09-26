// src/fs/atomic.ts
import { writeFileSync, renameSync, unlinkSync, openSync, fsyncSync, closeSync, chmodSync } from "node:fs";
import { dirname, basename, join } from "node:path";

/**
 * 原子替换：写临时文件 → fsync → rename。
 *
 * rename 在同一文件系统内是原子的，所以读者要么看到旧内容要么看到新内容，
 * 永远看不到写了一半的文件。fsync 保证 rename 之前内容已经落盘——否则断电后
 * 可能出现「文件名换了但内容是空的」。
 *
 * 临时文件与目标同目录：跨文件系统 rename 会退化成 copy+unlink，不再原子。
 *
 * 已知的可移植性风险：Windows 上 rename 覆盖一个被其他进程打开的文件会失败
 * （EPERM/EACCES）。Windows 是尽力而为（PRD 平台行），这一条记在 PRD §15
 * 的待决项里，由 Windows CI 明确覆盖。
 *
 * `mode`：替换一个已有文件时传它原来的权限位——临时文件从一开始就用这个权限建（不经过一个更宽的中间态），
 * rename 之后目标的权限不变。不传则按进程 umask 建（任务文件的常态）。F14 评审：用户的 settings.json 是
 * 0600，整文件替换后成了 0644。
 */
export function writeFileAtomic(path: string, content: string | Buffer, mode?: number): void {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    // 给了 mode：临时文件先只给自己读写（不比任何目标权限宽），fsync 之后再设成目标权限——目标若是只读的
    // （0444），先设的话 fsync 那一步就打不开了。
    writeFileSync(tmp, content, mode === undefined ? undefined : { mode: 0o600 });
    const fd = openSync(tmp, "r+");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    if (mode !== undefined) chmodSync(tmp, mode & 0o7777);
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* 临时文件可能压根没建起来 */ }
    throw err;
  }
}
