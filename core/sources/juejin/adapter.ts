// 掘金源 adapter（中文技术信息流，取代 HN 的外网依赖）：掘金推荐接口 → SourceItem[] → data/sources/juejin/latest.json。
// 国内可直连、免梯子、无鉴权；首期只做「入库 + feed 展示」，不判读 profile、不走 AI。
import { localDateStr } from "@/core/domain/calendar";
import { writeSourceLatest } from "@/core/store/file";
import type { SourceAdapter, SourceRunResult } from "../adapter";
import { fetchWithRetry } from "../fetch-retry";
import { normalizeJuejin, type JuejinArticle } from "./normalize";

const API = "https://api.juejin.cn/recommend_api/v1/article/recommend_all_feed";
const FETCH_TIMEOUT_MS = 20_000;
const LIMIT = 20;

async function fetchRecommended(): Promise<JuejinArticle[]> {
  const res = await fetchWithRetry(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_type: 2, cursor: "0", limit: LIMIT, sort_type: 200 }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`juejin HTTP ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ item_info?: { article_info?: JuejinArticle } }> };
  return (data?.data ?? [])
    .map((d) => d.item_info?.article_info)
    .filter((a): a is JuejinArticle => !!a);
}

async function runOnce(): Promise<number> {
  const articles = await fetchRecommended();
  const discoveredAt = localDateStr();
  const fetchedAt = new Date().toISOString();
  const items = normalizeJuejin(articles, discoveredAt);
  await writeSourceLatest("juejin", { source: "juejin", fetched_at: fetchedAt, date: discoveredAt, items });
  return items.length;
}

export const juejinAdapter: SourceAdapter = {
  id: "juejin",
  label: "掘金",
  run: async (): Promise<SourceRunResult> => {
    try {
      const n = await runOnce();
      return { sourceId: "juejin", ok: true, message: `拉取掘金 ${n} 条 → data/sources/juejin/latest.json` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[juejin] 拉取失败：${message}`);
      return { sourceId: "juejin", ok: false, message };
    }
  },
};
