// Hacker News 源 adapter（Phase 3 首个新源）：Algolia front_page → SourceItem[] → data/sources/hackernews/latest.json。
// 首期只做「入库 + 可展示」，不判读、不抓评论、不强接 AI（控 token）；详情由页面外链 HN 原生页。
import { localDateStr } from "@/core/domain/calendar";
import { writeHnHistory, writeSourceLatest } from "@/core/store/file";
import type { SourceAdapter, SourceRunResult } from "../adapter";
import { normalizeHn, type HnHit } from "./normalize";

const ALGOLIA_API = "https://hn.algolia.com/api/v1";
const FETCH_TIMEOUT_MS = 20_000;
const HITS_PER_PAGE = 50;

async function fetchFrontPage(): Promise<HnHit[]> {
  const res = await fetch(`${ALGOLIA_API}/search_by_date?tags=front_page&hitsPerPage=${HITS_PER_PAGE}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Algolia HTTP ${res.status}`);
  }
  const data = (await res.json()) as { hits?: HnHit[] };
  return data.hits ?? [];
}

async function runOnce(): Promise<number> {
  const hits = await fetchFrontPage();
  const discoveredAt = localDateStr();
  const items = normalizeHn(hits, discoveredAt);
  const fetchedAt = new Date().toISOString();
  await writeSourceLatest("hackernews", {
    source: "hackernews",
    fetched_at: fetchedAt,
    date: discoveredAt,
    items,
  });
  // Phase 5：同步落当日 HN 快照历史（供跨源周报提供逐日深度；幂等，非致命）
  await writeHnHistory({ date: discoveredAt, fetched_at: fetchedAt, items });
  return items.length;
}

export const hackernewsAdapter: SourceAdapter = {
  id: "hackernews",
  label: "Hacker News",
  run: async (): Promise<SourceRunResult> => {
    try {
      const n = await runOnce();
      return { sourceId: "hackernews", ok: true, message: `拉取 front_page ${n} 条 → data/sources/hackernews/latest.json` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[HN] 拉取失败：${message}`);
      return { sourceId: "hackernews", ok: false, message };
    }
  },
};
