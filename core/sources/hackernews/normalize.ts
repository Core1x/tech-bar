// Hacker News（Algolia API）raw → SourceItem 规范化（纯函数，可单测）。
// 映射：source_id=objectID；url=外链 || HN item 页；metrics=[points, num_comments]。
// Phase 3：不抓评论正文、不做判读 profile；tags 留空（HN 无话题元数据）。
import type { SourceItem } from "@/core/domain/types";

/** Algolia hit 中我们用到的字段（其余忽略） */
export interface HnHit {
  objectID: string;
  title?: string | null;
  story_text?: string | null;
  url?: string | null;
  points?: number | null;
  num_comments?: number | null;
  author?: string | null;
  created_at?: string | null;
}

export function hnItemUrl(objectID: string): string {
  return `https://news.ycombinator.com/item?id=${objectID}`;
}

/** 单条 hit → SourceItem（discoveredAt 由调用方传，便于测试） */
export function normalizeHnHit(hit: HnHit, discoveredAt: string): SourceItem {
  const objectID = hit.objectID;
  const title = (hit.title || hit.story_text || "").trim();
  const points = typeof hit.points === "number" && Number.isFinite(hit.points) ? hit.points : 0;
  const numComments =
    typeof hit.num_comments === "number" && Number.isFinite(hit.num_comments) ? hit.num_comments : 0;
  const desc = (hit.story_text ?? "").replace(/\s+/g, " ").trim();
  return {
    source: "hackernews",
    source_id: objectID,
    title: title || "(untitled)",
    url: hit.url || hnItemUrl(objectID),
    description: desc ? desc.slice(0, 400) : null,
    published_at: hit.created_at ?? undefined,
    discovered_at: discoveredAt,
    tags: [],
    metrics: [
      { name: "points", value: points },
      { name: "num_comments", value: numComments },
    ],
    _meta: { fetched_at: discoveredAt },
  };
}

/** hits → SourceItem[]，按 points 降序（同分按评论数） */
export function normalizeHn(hits: HnHit[], discoveredAt: string): SourceItem[] {
  return hits
    .filter((h) => h && typeof h.objectID === "string")
    .map((h) => normalizeHnHit(h, discoveredAt))
    .sort((a, b) => {
      const pa = a.metrics.find((m) => m.name === "points")?.value ?? 0;
      const pb = b.metrics.find((m) => m.name === "points")?.value ?? 0;
      if (pa !== pb) return pb - pa;
      const ca = a.metrics.find((m) => m.name === "num_comments")?.value ?? 0;
      const cb = b.metrics.find((m) => m.name === "num_comments")?.value ?? 0;
      return cb - ca;
    });
}
