// AI token 用量本地统计：按天累积写入 data/cache/ai-usage.json
// lib/deepseek 每次 AI 调用后追加（M2 起 CLI 也走 lib/deepseek，因此定时任务计入用量）。
import fs from "fs/promises";
import path from "path";
import { CACHE_DIR, atomicWrite } from "./data";

const USAGE_FILE = path.join(CACHE_DIR, "ai-usage.json");

const pad = (n: number) => String(n).padStart(2, "0");

/** 本地日期 YYYY-MM-DD（+08:00 场景用本地时区） */
function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface DayUsage {
  prompt: number;
  completion: number;
}

// 读-改-写非原子，并发 AI 调用会互相覆盖丢计数：用模块级 promise 串行化
let mutex: Promise<void> = Promise.resolve();

/** 记录一次 AI 调用的 token 用量（失败不影响主流程） */
export function addAiUsage(promptTokens: number, completionTokens: number): Promise<void> {
  const task = mutex.then(async () => {
    try {
      const date = localDateStr();
      let data: Record<string, DayUsage> = {};
      try {
        data = JSON.parse(await fs.readFile(USAGE_FILE, "utf-8")) as Record<string, DayUsage>;
      } catch {
        // 文件不存在或损坏 → 从头开始
      }
      const today = data[date] ?? { prompt: 0, completion: 0 };
      today.prompt += Math.round(promptTokens || 0);
      today.completion += Math.round(completionTokens || 0);
      data[date] = today;
      await atomicWrite(USAGE_FILE, JSON.stringify(data, null, 2));
    } catch {
      // 用量统计失败不影响 AI 功能
    }
  });
  mutex = task;
  return task;
}

/** 读取今天的 token 用量 */
export async function readAiUsage(): Promise<DayUsage> {
  try {
    const data = JSON.parse(await fs.readFile(USAGE_FILE, "utf-8")) as Record<string, DayUsage>;
    return data[localDateStr()] ?? { prompt: 0, completion: 0 };
  } catch {
    return { prompt: 0, completion: 0 };
  }
}
