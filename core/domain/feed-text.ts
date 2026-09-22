// 源中立文本块：把一组 FeedItem 排成「逐源已排序 + 各自原生度量」的文本，供跨源 AI 综述（A/C）拼 prompt。
// 关键纪律（docs/architecture.md §0/§4.10）：整合不混比 —— 只给"源内已排序条目 + 源各自原生度量"，
// 让模型自己跨源判断"今天谁值得看"，绝不把 ★star 与 pts 假合并成同一个榜。
// 纯函数、零 I/O、零跨层依赖（domain 层；板块参数用结构化类型，勿 import analysis 的 FeedSectionResult）。
import type { FeedItem } from "./types";

/** 一个「源板块」的结构化形状（FeedSectionResult 等价子集；analysis 层按此传入即可） */
export interface FeedTextSection {
  sourceLabel: string;
  items: FeedItem[];
}

/** 单条 FeedItem → 一行文本（行内带源标识，模型可区分来源与各自度量） */
export function feedItemToText(item: FeedItem): string {
  const metric = item.metric ? `｜${item.metric.label}` : "";
  const secondary = item.secondary ? `｜${item.secondary}` : "";
  const tags = item.tags.length > 0 ? `｜tags ${item.tags.slice(0, 5).join("/")}` : "";
  const desc = item.description ? `｜${item.description.replace(/\s+/g, " ").slice(0, 120)}` : "";
  return `- [${item.sourceLabel}] ${item.title}${metric}${secondary}${tags}${desc}`;
}

/** 一个源板块 → 文本块（逐源归一排序，只取该源条目；首行带源名与条数，便于模型感知数据范围） */
export function feedSectionToText(section: FeedTextSection, limit = 20): string {
  const items = section.items.slice(0, limit).map(feedItemToText).join("\n");
  return `【${section.sourceLabel} · 今日${section.items.slice(0, limit).length} 条】\n${items}`;
}

/** 全部源板块 → 源中立文本块（供跨源综述 prompt 的输入段） */
export function buildFeedTextBlock(sections: FeedTextSection[], limitPerSource = 20): string {
  return sections.map((s) => feedSectionToText(s, limitPerSource)).join("\n\n");
}
