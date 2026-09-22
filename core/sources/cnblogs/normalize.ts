// 博客园（cnblogs）首页 RSS → SourceItem 规范化（原创技术博客资讯流，国内可直连、免梯子、无鉴权）。
// 零依赖解析 Atom XML（无 XML parser 依赖；用正则提取 <entry> 字段）。
// 映射：source_id=entry 链接；url=entry 链接；description=summary 剥 HTML；published_at=published；
// tags 留空（RSS 无话题元数据）；metrics 空（无热度）→ feed 映射时 metric=null，secondary 显示作者/时间。
import type { SourceItem } from "@/core/domain/types";

/** 解析后的单篇博客（entry 关键字段） */
export interface CnblogsEntry {
  id: string;
  title: string;
  link: string;
  summary: string;
  author: string;
  published?: string;
}

function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  return m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** 提取 <link rel="alternate" href="..."> 的 href */
function pickLinkHref(block: string): string {
  const m = block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"[^>]*>/i);
  return m?.[1] ?? "";
}

/** 整段 RSS → 单个 entry 块（粗切，容忍跨块） */
function extractEntryBlocks(xml: string): string[] {
  return (xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []).map((e) => e.replace(/^<entry>/, "").replace(/<\/entry>$/, ""));
}

/** RSS XML → CnblogsEntry[]（纯函数）；过滤无链接/无标题 */
export function parseCnblogsRss(xml: string): CnblogsEntry[] {
  return extractEntryBlocks(xml)
    .map((b): CnblogsEntry => {
      const link = pickLinkHref(b);
      const id = b.match(/<id[^>]*>([\s\S]*?)<\/id>/i)?.[1]?.trim() || link || "";
      const author = (b.match(/<name[^>]*>([\s\S]*?)<\/name>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
      return {
        id,
        title: pick(b, "title"),
        link,
        summary: pick(b, "summary").slice(0, 300),
        author,
        published: b.match(/<published[^>]*>([\s\S]*?)<\/published>/i)?.[1]?.trim().slice(0, 19),
      };
    })
    .filter((e) => e.title && (e.link || e.id));
}

/** CnblogsEntry[] → SourceItem[]（discoveredAt；published 保留为 published_at） */
export function entryToSourceItem(e: CnblogsEntry, discoveredAt: string): SourceItem {
  return {
    source: "cnblogs",
    source_id: e.id,
    title: e.title.length > 120 ? `${e.title.slice(0, 120)}…` : e.title,
    url: e.link || e.id,
    description: e.summary || null,
    published_at: e.published,
    discovered_at: discoveredAt,
    language: null,
    tags: [],
    metrics: [],
    _meta: { fetched_at: discoveredAt },
  };
}

export function normalizeCnblogs(entries: CnblogsEntry[], discoveredAt: string): SourceItem[] {
  return entries.map((e) => entryToSourceItem(e, discoveredAt));
}
