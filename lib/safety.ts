// 内容安全关键词过滤(服务端专用)：明显的色情/NSFW 标记 + 用户追加词。
// 「涉政敏感 / 虚假夸大宣传」这类需要判断力的类别主要靠 /api/find 的 AI 兜底判定，
// 关键词层刻意保守（宁可漏放也不误伤正常仓库，如学术/统计/内容安全检测类项目）。
// 配置：data/config/safety-keywords.json（enabled + keywords 追加合并到默认词表；enabled=false 整体关闭）。
import fs from "node:fs/promises";
import path from "node:path";

const CONFIG_PATH = path.join(process.cwd(), "data", "config", "safety-keywords.json");

/** 内置默认词表：无歧义的色情/NSFW 标记（不含 sex/adult/violence 等易误伤泛词） */
export const DEFAULT_KEYWORDS: string[] = [
  "nudify",
  "deepnude",
  "nsfw",
  "hentai",
  "onlyfans",
  "porn",
  "escort",
  "milf",
  "xvideo",
  "色情",
  "裸聊",
  "黄片",
  "黄播",
  "成人影片",
];

export interface SafetyKeywordsConfig {
  enabled: boolean;
  keywords: string[];
}

/** 读取过滤配置：存在则 keywords 追加合并默认词；缺失/损坏只返回默认词 */
export async function readSafetyKeywords(): Promise<SafetyKeywordsConfig> {
  const extra: string[] = [];
  try {
    const obj = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8")) as { enabled?: unknown; keywords?: unknown };
    if (obj && typeof obj === "object") {
      if (obj.enabled === false) {
        // 配置文件显式关闭 → 关键词层整体不生效（仍可留空 keywords 表意）
        return { enabled: false, keywords: [] };
      }
      if (Array.isArray(obj.keywords)) {
        for (const k of obj.keywords) {
          if (typeof k === "string" && k.trim() !== "") extra.push(k);
        }
      }
    }
  } catch {
    // 配置缺失或损坏 → 仅用默认词
  }
  return { enabled: true, keywords: [...DEFAULT_KEYWORDS, ...extra] };
}

/**
 * 命中任一关键词即认为应过滤（对 full_name + description + topics 合并文本做小写子串匹配）。
 * keywords 为空时恒返回 false（整体关闭或词表为空 → 不过滤）。
 */
export function keywordBlocked(
  fullName: string,
  description: string | null | undefined,
  topics: string[] | undefined,
  keywords: string[],
): boolean {
  if (keywords.length === 0) return false;
  const text = `${fullName ?? ""} ${description ?? ""} ${(topics ?? []).join(" ")}`.toLowerCase();
  for (const k of keywords) {
    if (k && text.includes(k.toLowerCase())) return true;
  }
  return false;
}
