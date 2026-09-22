// 兴趣偏好配置（data/config/preferences.json，M5 §11.3）——本地单用户偏好，仅影响「今日必须看」的候选加权，
// **不改变原始榜单与完整信息流**（设置界面必须说明此边界）。读-改-写模块级串行 + atomicWrite（全站约定）。
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR, atomicWrite } from "@/core/store/file";

export type InterestBias = "new" | "mature" | "neutral";

export interface InterestPreferences {
  /** 关注语言（GitHub primary language，忽略大小写） */
  languages: string[];
  /** 关注主题（小写话题词） */
  topics: string[];
  /** 不感兴趣主题（命中即重罚出队尾，但不删除条目） */
  negativeTopics: string[];
  /** 首页偏向：新项目 / 成熟项目 / 中立 */
  bias: InterestBias;
}

export const PREFERENCES_FILE = path.join(CONFIG_DIR, "preferences.json");

export const DEFAULT_PREFERENCES: InterestPreferences = {
  languages: [],
  topics: [],
  negativeTopics: [],
  bias: "neutral",
};

/** 清洗一组字符串：条目内也按逗号/顿号/空白再拆分（防整串当一个词存）、小写、限长限量；非法输入回退 [] */
function cleanList(v: unknown, max = 20): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    for (const part of x.split(/[,，、;；\s]+/)) {
      const s = part.trim().toLowerCase();
      if (!s || s.length > 40 || out.includes(s)) continue;
      out.push(s);
      if (out.length >= max) return out;
    }
  }
  return out;
}

export function sanitizePreferences(input: unknown): InterestPreferences {
  const o = (input ?? {}) as Record<string, unknown>;
  const bias: InterestBias = o.bias === "new" || o.bias === "mature" ? o.bias : "neutral";
  return {
    languages: cleanList(o.languages, 12),
    topics: cleanList(o.topics),
    negativeTopics: cleanList(o.negativeTopics),
    bias,
  };
}

export async function readPreferences(): Promise<InterestPreferences> {
  try {
    const obj = JSON.parse(await fs.readFile(PREFERENCES_FILE, "utf-8")) as unknown;
    return sanitizePreferences(obj);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

let writeChain: Promise<void> = Promise.resolve();

/** 合并写回（partial：只更新给出的键），返回写后的全量偏好 */
export async function writePreferences(partial: Partial<Record<keyof InterestPreferences, unknown>>): Promise<InterestPreferences> {
  const run = writeChain.then(async () => {
    const cur = await readPreferences();
    const next: InterestPreferences = {
      languages: "languages" in partial ? cleanList(partial.languages, 12) : cur.languages,
      topics: "topics" in partial ? cleanList(partial.topics) : cur.topics,
      negativeTopics: "negativeTopics" in partial ? cleanList(partial.negativeTopics) : cur.negativeTopics,
      bias:
        partial.bias === "new" || partial.bias === "mature" || partial.bias === "neutral"
          ? partial.bias
          : cur.bias,
    };
    await atomicWrite(PREFERENCES_FILE, JSON.stringify(next, null, 2) + "\n");
  });
  writeChain = run.catch(() => {});
  await run;
  return readPreferences();
}
