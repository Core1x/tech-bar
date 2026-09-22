// 博客园源 adapter（中文原创博客资讯流，取代部分外网依赖）：sitehome RSS → SourceItem[] → data/sources/cnblogs/latest.json。
// 国内可直连、免梯子、无鉴权；首期只「入库 + feed 展示」，不判读、不走 AI。
import { localDateStr } from "@/core/domain/calendar";
import { writeSourceLatest } from "@/core/store/file";
import type { SourceAdapter, SourceRunResult } from "../adapter";
import { fetchWithRetry } from "../fetch-retry";
import { normalizeCnblogs, parseCnblogsRss } from "./normalize";

const RSS_URL = "https://feed.cnblogs.com/blog/sitehome/rss";
const FETCH_TIMEOUT_MS = 20_000;

async function fetchRss(): Promise<string> {
  const res = await fetchWithRetry(RSS_URL, {
    headers: { Accept: "application/atom+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`cnblogs HTTP ${res.status}`);
  return res.text();
}

async function runOnce(): Promise<number> {
  const xml = await fetchRss();
  const discoveredAt = localDateStr();
  const fetchedAt = new Date().toISOString();
  const entries = parseCnblogsRss(xml);
  const items = normalizeCnblogs(entries, discoveredAt);
  await writeSourceLatest("cnblogs", { source: "cnblogs", fetched_at: fetchedAt, date: discoveredAt, items });
  return items.length;
}

export const cnblogsAdapter: SourceAdapter = {
  id: "cnblogs",
  label: "博客园",
  run: async (): Promise<SourceRunResult> => {
    try {
      const n = await runOnce();
      return { sourceId: "cnblogs", ok: true, message: `拉取博客园 ${n} 条 → data/sources/cnblogs/latest.json` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cnblogs] 拉取失败：${message}`);
      return { sourceId: "cnblogs", ok: false, message };
    }
  },
};
