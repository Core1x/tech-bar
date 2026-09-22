// /api/watchlist 的前端共用封装（M2）：切换关注时随请求附带展示快照
// （title/url/description/lastMetricLabel/capturedAt）——条目离开今日榜单后关注页仍能解释"关注的是什么"。
// 取消（服务端移除条目）时快照自然无效，服务端只在新增分支写入。

export interface WatchPostItem {
  source: string;
  sourceId: string;
  title: string;
  url: string;
  description?: string | null;
  metricLabel?: string | null;
}

export function watchSnapshotOf(item: { source: string; sourceId: string; title: string; url: string; description?: string | null; metric?: { label: string } | null }): WatchPostItem {
  return {
    source: item.source,
    sourceId: item.sourceId,
    title: item.title,
    url: item.url,
    description: item.description ?? null,
    metricLabel: item.metric?.label ?? null,
  };
}

export function postWatchToggle(item: WatchPostItem): Promise<Response> {
  return fetch("/api/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: item.source,
      source_id: item.sourceId,
      snapshot: {
        title: item.title,
        url: item.url,
        description: item.description ?? null,
        lastMetricLabel: item.metricLabel ?? null,
        capturedAt: new Date().toISOString(),
      },
    }),
  });
}
