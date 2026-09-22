// 统一信息流装配（多源、可插拔）。只读各源「今日已落库快照」，零生成式 I/O、零拉取。
// 源集合来自「启用源配置」（core/config/sources.ts，默认 github + juejin + cnblogs，HN 默认关）；
// 各源独立排序、并列分块 —— 度量绝不跨源混比。GitHub 读顶层 latest.json（D3 垫片），其它源读 sources/{id}/latest.json。
import { readLatest, readSourceLatest, readWatchlist, watchlistKey } from "@/core/store/file";
import { readActiveSources } from "@/core/config/sources";
import { computeSignals } from "@/core/domain/signals";
import { formatStars } from "@/core/domain/format";
import type { FeedItem, HotRepo, NewStarRepo, SourceItem, TrendingRepo } from "@/core/domain/types";
import { applyGrouping, groupFeedItems } from "./grouping";

/** 分区最新快照结构（各 SourceItem 型源写入） */
export interface SourceLatest {
  source: string;
  fetched_at: string;
  date: string;
  items: SourceItem[];
}

export const SOURCE_LABELS: Record<string, string> = {
  github: "GitHub",
  hackernews: "Hacker News",
  juejin: "掘金",
  cnblogs: "博客园",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export function feedItemKey(source: string, sourceId: string): string {
  return `${source}:${sourceId}`;
}

/** 取 SourceItem 中某命名度量值（缺省 0） */
export function sourceMetricValue(item: SourceItem, name: string): number {
  return item.metrics.find((m) => m.name === name)?.value ?? 0;
}

/** 度量 → 展示文案（各源原生度量，绝不跨源混比） */
export function metricLabel(name: string, value: number): string {
  switch (name) {
    case "points":
      return `${value} pts`;
    case "num_comments":
    case "comment":
      return `${value} 评论`;
    case "digg":
      return `${value} 赞`;
    case "view":
      return `${value} 浏览`;
    default:
      return `${value} ${name}`;
  }
}

/**
 * GitHub 新星榜仓库 → FeedItem。
 * signals 用 computeSignals 保守规则，剔掉「active」绿 chip（新星榜仓库按构造 ≤30 天，必绿=噪音，与 RepoRow 一致）。
 */
export function githubRepoToFeedItem(repo: NewStarRepo, date: string, watched: Set<string>): FeedItem {
  const key = feedItemKey("github", repo.full_name);
  const signals = computeSignals(repo);
  const chips = signals.chips.filter((c) => c.kind !== "active");
  const delta =
    typeof repo.delta_1d === "number" && Number.isFinite(repo.delta_1d) && repo.delta_1d > 0
      ? `↑${formatStars(repo.delta_1d)}`
      : null;
  return {
    key,
    source: "github",
    sourceId: repo.full_name,
    sourceLabel: sourceLabel("github"),
    title: repo.full_name,
    url: repo.html_url,
    description: repo.summary || repo.description || null,
    tags: repo.topics ?? [],
    metric: { name: "stars", value: repo.stars, label: `★ ${formatStars(repo.stars)}` },
    secondary: delta,
    signals: chips.length > 0 ? { ...signals, chips } : null,
    discoveredAt: date,
    watched: watched.has(key),
  };
}

/**
 * GitHub Explore 趋势榜条目 → FeedItem（口径=当日新增 star，与 github.com/trending 一致）。
 * 与新星榜不同：趋势条目可能创建多年，"活跃维护"绿 chip 是真信号，不再剔除。
 */
export function githubTrendingToFeedItem(repo: TrendingRepo, date: string, watched: Set<string>): FeedItem {
  const key = feedItemKey("github", repo.full_name);
  const signals = computeSignals(repo);
  const delta =
    Number.isFinite(repo.stars_today) && repo.stars_today > 0 ? `↑${formatStars(repo.stars_today)}` : null;
  return {
    key,
    source: "github",
    sourceId: repo.full_name,
    sourceLabel: sourceLabel("github"),
    title: repo.full_name,
    url: repo.html_url,
    description: repo.summary || repo.description || null,
    tags: repo.topics ?? [],
    metric: { name: "stars", value: repo.stars, label: `★ ${formatStars(repo.stars)}` },
    secondary: delta,
    signals: signals.chips.length > 0 ? signals : null,
    discoveredAt: date,
    watched: watched.has(key),
  };
}

/**
 * GitHub 热榜（存量榜 /hot）条目 → FeedItem。口径=总 star 存量，度量 ★总数 + 次要 forks。
 * 与新星榜不同：存量榜仓库年限不限，"活跃维护"是真信号，不剔 active chip（同趋势榜语义）。
 */
export function hotRepoToFeedItem(repo: HotRepo, date: string, watched: Set<string>): FeedItem {
  const key = feedItemKey("github", repo.full_name);
  const signals = computeSignals(repo);
  const forks = typeof repo.forks === "number" && repo.forks > 0 ? `${formatStars(repo.forks)} forks` : null;
  return {
    key,
    source: "github",
    sourceId: repo.full_name,
    sourceLabel: sourceLabel("github"),
    title: repo.full_name,
    url: repo.html_url,
    description: repo.summary || repo.description || null,
    tags: repo.topics ?? [],
    metric: { name: "stars", value: repo.stars, label: `★ ${formatStars(repo.stars)}` },
    secondary: forks,
    signals: signals.chips.length > 0 ? signals : null,
    discoveredAt: date,
    watched: watched.has(key),
  };
}

/** 任意 SourceItem 型源（hackernews/juejin/cnblogs）→ FeedItem；度量取 metrics[0] 为主、[1]/[2] 为次要；无判读 signals */
export function sourceItemToFeedItem(source: string, item: SourceItem, watched: Set<string>): FeedItem {
  const key = feedItemKey(source, item.source_id);
  const [m0, m1, m2] = item.metrics ?? [];
  const secondaryParts: string[] = [];
  if (m1 && m1.value > 0) secondaryParts.push(metricLabel(m1.name, m1.value));
  if (m2 && m2.value > 0) secondaryParts.push(metricLabel(m2.name, m2.value));
  const secondary =
    secondaryParts.length > 0
      ? secondaryParts.join(" · ")
      : item.published_at
        ? item.published_at.slice(0, 10)
        : null;
  return {
    key,
    source,
    sourceId: item.source_id,
    sourceLabel: sourceLabel(source),
    title: item.title,
    url: item.url,
    description: item.description ?? null,
    tags: item.tags ?? [],
    metric: m0 ? { name: m0.name, value: m0.value, label: metricLabel(m0.name, m0.value) } : null,
    secondary,
    signals: null, // 非 github 无判读 profile
    discoveredAt: item.discovered_at,
    watched: watched.has(key),
  };
}

/** HN SourceItem → FeedItem（兼容导出：= sourceItemToFeedItem("hackernews",...)） */
export function hnItemToFeedItem(item: SourceItem, watched: Set<string>): FeedItem {
  return sourceItemToFeedItem("hackernews", item, watched);
}

/** 关注集合（`${source}:${source_id}`） */
export async function watchedKeySet(): Promise<Set<string>> {
  const list = await readWatchlist();
  return new Set(list.map((e) => watchlistKey(e.source, e.source_id)));
}

export interface BuildFeedOptions {
  /** 只看某源（"github"|"juejin"|"cnblogs"|"hackernews"），缺省 = 全部启用源 */
  source?: string;
  /** 只看已关注条目 */
  onlyWatched?: boolean;
}

export interface FeedSectionResult {
  id: string;
  title: string;
  sourceLabel: string;
  items: FeedItem[];
  fetchedAt: string | null;
  count: number;
}

/** 从启用源清单读取并装配一个板块（github 单独逻辑，其它走 SourceItem 源） */
async function sectionFor(id: string, watched: Set<string>): Promise<FeedSectionResult | null> {
  if (id === "github") {
    const latest = await readLatest();
    if (!latest) return null;
    // 优先 Explore 趋势榜（当日新增 star 口径）；抓取失败/旧数据缺省时回落新星榜（近30天新仓按总 star）
    const trending = latest.trending ?? [];
    const items = trending.length > 0
      ? trending.map((t) => githubTrendingToFeedItem(t, latest.date, watched))
      : latest.new_stars.map((r) => githubRepoToFeedItem(r, latest.date, watched));
    return {
      id: "github",
      title: trending.length > 0 ? "GitHub 趋势榜" : "GitHub 今日热门",
      sourceLabel: sourceLabel("github"),
      items,
      fetchedAt: latest.updated_at,
      count: items.length,
    };
  }
  const latest = await readSourceLatest<SourceLatest>(id);
  if (!latest?.items?.length) return null;
  const items = latest.items.map((i) => sourceItemToFeedItem(id, i, watched));
  return {
    id,
    title: `${sourceLabel(id)} 今日热门`,
    sourceLabel: sourceLabel(id),
    items,
    fetchedAt: latest.fetched_at,
    count: items.length,
  };
}

/**
 * 装配统一信息流：按「启用源配置」逐源读今日快照、各源自排序并列返回板块。
 * 只读已落库快照；不触发任何生成式 I/O / 拉取 / AI。
 */
export async function buildFeed(opts: BuildFeedOptions = {}): Promise<FeedSectionResult[]> {
  const watched = await watchedKeySet();
  const active = await readActiveSources();
  // opts.source 只限定某源时，仅当它在启用清单里才返回
  const targets = opts.source ? active.filter((s) => s === opts.source) : active;

  const sections: FeedSectionResult[] = [];
  for (const id of targets) {
    const s = await sectionFor(id, watched);
    if (s) sections.push(s);
  }

  // 跨源去重/串联：给今日各源条目按 canonical subject 聚簇，写 groupId（仅 ≥2 不同源成组）
  const { assignments } = groupFeedItems(sections.flatMap((s) => s.items));
  const result = sections.map((s) => ({ ...s, items: applyGrouping(s.items, assignments) }));

  if (!opts.onlyWatched) return result;
  return result
    .map((s) => ({ ...s, items: s.items.filter((i) => i.watched) }))
    .filter((s) => s.items.length > 0);
}
