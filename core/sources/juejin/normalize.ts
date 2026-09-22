// 掘金（juejin.cn）推荐内容流 raw → SourceItem 规范化（中文技术信息源，取代 HN；国内可直连、免梯子）。
// 映射：source_id=article_id；url=外链||juejin 文章页；metrics=[digg(赞) 主, comment(评论), view(浏览)]。
// tags 首期留空（掘金 category/tag 为数字 id，无名字，避免假标签）。
import type { SourceItem } from "@/core/domain/types";

/** 掘金 article_info 中我们用到的字段（其余忽略） */
export interface JuejinArticle {
  article_id: string;
  title?: string | null;
  brief_content?: string | null;
  link_url?: string | null;
  ctime?: number | string;
  digg_count?: number;
  comment_count?: number;
  view_count?: number;
}

export function juejinItemUrl(articleId: string): string {
  return `https://juejin.cn/post/${articleId}`;
}

/** 秒级 unix → ISO 串（缺省/非法 → undefined） */
function isoFromCtime(ctime?: number | string): string | undefined {
  const n = Number(ctime);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function num(v: number | undefined | null): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 单条 article_info → SourceItem（discoveredAt 由调用方传，便于测试） */
export function normalizeJuejinHit(hit: JuejinArticle, discoveredAt: string): SourceItem {
  const id = hit.article_id;
  return {
    source: "juejin",
    source_id: id,
    title: (hit.title || "").trim() || "(untitled)",
    url: hit.link_url && hit.link_url.trim() ? hit.link_url.trim() : juejinItemUrl(id),
    description: (hit.brief_content ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null,
    published_at: isoFromCtime(hit.ctime),
    discovered_at: discoveredAt,
    language: null,
    tags: [],
    metrics: [
      { name: "digg", value: num(hit.digg_count) },
      { name: "comment", value: num(hit.comment_count) },
      { name: "view", value: num(hit.view_count) },
    ],
    _meta: { fetched_at: discoveredAt },
  };
}

/** articles → SourceItem[]，按 digg（赞）降序（同分按评论）；过滤无 id */
export function normalizeJuejin(hits: JuejinArticle[], discoveredAt: string): SourceItem[] {
  return hits
    .filter((h) => h && typeof h.article_id === "string" && h.article_id.length > 0)
    .map((h) => normalizeJuejinHit(h, discoveredAt))
    .sort((a, b) => {
      const da = a.metrics.find((m) => m.name === "digg")?.value ?? 0;
      const db = b.metrics.find((m) => m.name === "digg")?.value ?? 0;
      if (da !== db) return db - da;
      const ca = a.metrics.find((m) => m.name === "comment")?.value ?? 0;
      const cb = b.metrics.find((m) => m.name === "comment")?.value ?? 0;
      return cb - ca;
    });
}
