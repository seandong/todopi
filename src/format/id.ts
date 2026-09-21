// src/format/id.ts
import { randomInt } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const BODY_LENGTH = 6;

/**
 * 生成 id 的 body：六位 base36（spec §4）。
 *
 * 随机而非顺序：spec §4 的理由是「多个 agent 在多个分支上并发创建任务，
 * 顺序编号会在合并时碰撞」。36^6 ≈ 22 亿，跨分支碰撞可忽略；同一个 tasks/
 * 里的碰撞由写入端在持锁期间检查文件名排除。
 *
 * 用 crypto.randomInt 而非 Math.random：后者在同一毫秒启动的多个进程里可能产出
 * 相同序列，而并发 add 正是本 feature 要支持的场景。
 */
export function newIdBody(): string {
  let body = "";
  for (let i = 0; i < BODY_LENGTH; i++) body += ALPHABET[randomInt(ALPHABET.length)];
  return body;
}

export function makeId(prefix: string, body: string): string {
  return `${prefix}-${body}`;
}
