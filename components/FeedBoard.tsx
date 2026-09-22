"use client";
// 技术热点追踪看板（原「聚合信息流」）：源分块并列 + 源 Tab + 「只看关注」过滤 + 关注切换（乐观更新，失败回滚 + 提示）。
// 数据全部来自服务端 buildFeed（只读今日快照），客户端仅做展示增量与交互，不触发 AI / 拉取。
// GitHub 板块另收到原始 LatestData，切到「GitHub」Tab 时渲染完整视图（语言 Tab + 追踪池）——延续原 GitHub 首页行为。
import { useMemo, useState } from "react";
import type { FeedItem, LatestData, NewStarRepo, TrendingRepo } from "@/lib/types";
import type { FeedSectionResult } from "@/core/analysis/feed";
import { itemHrefFor } from "@/core/analysis/profile";
import { TrendingTabs } from "./TrendingTabs";
import { TrackedTrend } from "./TrackedTrend";
import { FeedCard } from "./FeedCard";
import { RepoRow } from "./RepoRow";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { postWatchToggle, watchSnapshotOf } from "./watchApi";
import { CompareButton } from "./CompareButton";

/** Explore 趋势榜条目 → RepoRow 所需的 NewStarRepo 形状（delta_1d=当日新增 star，与页面语义一致） */
function trendingAsRow(t: TrendingRepo): NewStarRepo {
  return {
    rank: t.rank,
    full_name: t.full_name,
    description: t.description,
    summary: t.summary,
    language: t.language,
    stars: t.stars,
    created_at: t.created_at ?? "",
    topics: t.topics ?? [],
    html_url: t.html_url,
    delta_1d: t.stars_today,
    pushed_at: t.pushed_at,
    archived: t.archived,
    license: t.license,
  };
}

const SOURCE_ACCENT: Record<string, string> = {
  github: "text-[#58a6ff] border-[#58a6ff]/30",
  hackernews: "text-[#ff6600] border-[#ff6600]/30",
  juejin: "text-[#1e80ff] border-[#1e80ff]/30",
  cnblogs: "text-[#2b7cd3] border-[#2b7cd3]/30",
};

/** 技术文章类源（掘金/博客园）：聚合视图固定放右侧同一竖列，默认收起可展开 */
const ARTICLE_SOURCES = new Set(["juejin", "cnblogs"]);

const DEFAULT_LIMIT = 15;

/** 源最新时间展示（各源格式不同：github 带 +08:00、hn 为 Z）→ 统一本地时区 */
function fmtUpdated(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type SourceTab = string; // "all"(聚合) 或某启用源的 id（github/juejin/cnblogs/…，动态）

/** 条目内部详情页 href（跨源统一，经 core/analysis/profile 注册表分派） */
function itemDetailHref(item: FeedItem): string {
  return itemHrefFor(item.source, item.sourceId) || item.url;
}

export function FeedBoard({
  sections,
  githubLatest,
}: {
  sections: FeedSectionResult[];
  /** GitHub 原始今日数据（供「GitHub」Tab 完整视图：语言 Tab + 追踪池），无则降级为 feed 卡片 */
  githubLatest?: LatestData | null;
}) {
  const [activeSource, setActiveSource] = useState<SourceTab>("all");
  const [watchedOnly, setWatchedOnly] = useState(false);
  const [watchState, setWatchState] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const s of sections) for (const it of s.items) m[it.key] = it.watched;
    return m;
  });
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // 只看某源 + 只看关注，两层过滤后的展示列表
  const visibleSections = useMemo(() => {
    let list = sections;
    if (activeSource !== "all") list = list.filter((s) => s.id === activeSource);
    // 关注态以本地 watchState 为准（用户刚切换即生效）
    list = list.map((s) => ({
      ...s,
      items: s.items.map((it) => ({ ...it, watched: watchState[it.key] ?? it.watched })),
    }));
    if (watchedOnly) list = list.map((s) => ({ ...s, items: s.items.filter((it) => it.watched) })).filter((s) => s.items.length > 0);
    return list;
  }, [sections, activeSource, watchedOnly, watchState]);

  const totalVisible = visibleSections.reduce((n, s) => n + s.items.length, 0);

  // 聚合视图两列划分：主源（GitHub/HN…）左列纵向堆叠；技术文章源（掘金/博客园）收进右列同一竖列
  const [mainSections, articleSections] = useMemo(() => {
    const main: FeedSectionResult[] = [];
    const articles: FeedSectionResult[] = [];
    for (const s of visibleSections) (ARTICLE_SOURCES.has(s.id) ? articles : main).push(s);
    return [main, articles];
  }, [visibleSections]);

  // 跨源分组（Phase 5）：把今日各源条目按 groupId 聚簇，供卡片显示"同主题跨源"徽标并互链。
  // groupId 由服务端 buildFeed 的 groupFeedItems 写入（仅 ≥2 不同源成组）。
  const groupMap = useMemo(() => {
    const m = new Map<string, FeedItem[]>();
    for (const s of sections)
      for (const it of s.items)
        if (it.groupId) {
          const bucket = m.get(it.groupId);
          if (bucket) bucket.push(it);
          else m.set(it.groupId, [it]);
        }
    return m;
  }, [sections]);

  // 该条目的跨源分组信息：同组条数 + 一个"其它源"兄弟条目的内部详情链接（供互链）
  function groupFor(item: FeedItem): { count: number; href?: string } {
    if (!item.groupId) return { count: 0 };
    const members = groupMap.get(item.groupId);
    if (!members || members.length < 2) return { count: 0 };
    const sibling = members.find((m) => m.source !== item.source);
    return { count: members.length, href: sibling ? itemDetailHref(sibling) : undefined };
  }

  async function toggleWatch(item: FeedItem) {
    if (pendingKeys.has(item.key)) return;
    const prev = watchState[item.key] ?? item.watched;
    setPendingKeys((p) => new Set(p).add(item.key));
    setError(null);
    // 乐观翻转
    setWatchState((m) => ({ ...m, [item.key]: !prev }));
    try {
      const res = await postWatchToggle(watchSnapshotOf(item));
      const json = (await res.json()) as { ok?: boolean; watched?: boolean; error?: string };
      if (!json.ok || typeof json.watched !== "boolean") {
        setWatchState((m) => ({ ...m, [item.key]: prev })); // 回滚
        setError(json?.error || "切换关注失败");
      }
      // 成功保持乐观值（服务端返回的 watched 与乐观值一致）
    } catch {
      setWatchState((m) => ({ ...m, [item.key]: prev })); // 回滚
      setError("网络错误，切换关注失败");
    } finally {
      setPendingKeys((p) => {
        const n = new Set(p);
        n.delete(item.key);
        return n;
      });
    }
  }

  function toggleExpand(id: string) {
    setExpanded((e) => {
      const n = new Set(e);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  if (sections.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-[#30363d] bg-[#161b22] p-10 text-center">
        <p className="text-[#e6edf3]">暂无数据</p>
        <p className="mt-2 text-sm text-[#8b949e]">
          运行{" "}
          <code className="rounded bg-[#21262d] px-1.5 py-0.5 text-[#58a6ff]">node dist/cli/run-source.mjs all</code>{" "}
          拉取各源后显示
        </p>
      </div>
    );
  }

  // 源 Tab 按「启用源」（buildFeed 返回的板块）动态生成 —— 未被启用的源（如默认关闭的 HN）不出现
  const tabs: Array<{ key: SourceTab; label: string }> = [
    { key: "all", label: "技术热点追踪" },
    ...sections.map((s) => ({ key: s.id, label: s.sourceLabel })),
  ];

  return (
    <div className="mt-6">
      {/* 控制栏：源 Tab + 只看关注 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-md border border-[#30363d] bg-[#161b22] p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveSource(t.key)}
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                activeSource === t.key ? "bg-[#30363d] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {error ? <span className="text-xs text-[#f85149]">{error}</span> : null}
          <button
            type="button"
            onClick={() => setWatchedOnly((w) => !w)}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
              watchedOnly
                ? "border-[#e3b341]/50 bg-[#e3b341]/15 text-[#e3b341]"
                : "border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#e6edf3]"
            }`}
          >
            {watchedOnly ? "★" : "☆"} 只看关注{watchedOnly && totalVisible > 0 ? ` (${totalVisible})` : ""}
          </button>
        </div>
      </div>

      {/* 源分块（各源独立排序、并列；度量不跨源混比） */}
      {activeSource === "github" && githubLatest ? (
        /* GitHub 完整视图：Explore 趋势榜（当日新增 star 口径）+ 新星榜（语言 Tab）+ 追踪池趋势；均可折叠 */
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="min-w-0 space-y-6">
            {githubLatest.trending && githubLatest.trending.length > 0 ? (
              <CollapsiblePanel
                title="GitHub 趋势榜"
                subtitle="与 GitHub Explore 同步 · 按当日新增 star"
                defaultOpen
                titleClassName="text-lg font-semibold"
              >
                <div className="-mx-4 -mt-2">
                  {githubLatest.trending.map((t) => (
                    <RepoRow key={t.full_name} repo={trendingAsRow(t)} />
                  ))}
                </div>
              </CollapsiblePanel>
            ) : null}
            <CollapsiblePanel
              title="今日新星榜"
              subtitle="近 30 天新建 · 按总 star"
              defaultOpen={!githubLatest.trending || githubLatest.trending.length === 0}
              titleClassName="text-lg font-semibold"
            >
              <TrendingTabs repos={githubLatest.new_stars} />
            </CollapsiblePanel>
          </section>
          {githubLatest.tracked.length > 0 ? (
            <section className="min-w-0">
              <CollapsiblePanel
                title="追踪池趋势"
                subtitle="按近日新增 star 排序，Top 20"
                defaultOpen={false}
                titleClassName="text-lg font-semibold"
              >
                <TrackedTrend tracked={githubLatest.tracked} />
              </CollapsiblePanel>
            </section>
          ) : null}
        </div>
      ) : activeSource === "all" ? (
        /* 聚合视图（M1 起）：所有板块默认收起——首屏让给「今日必须看」简报（§7.6 不默认展开完整 GitHub 20 条），
           板块标题行保留条数提示，点开即完整信息流（§3.3 下钻/核对入口不丢） */
        <div className={`grid grid-cols-1 gap-6 ${articleSections.length > 0 && mainSections.length > 0 ? "xl:grid-cols-2" : ""}`}>
          <div className="min-w-0 space-y-6">
            {mainSections.map((s) =>
              renderSection(s, expanded, toggleExpand, toggleWatch, pendingKeys, groupFor, false),
            )}
          </div>
          {articleSections.length > 0 ? (
            <div className="min-w-0 space-y-6">
              {articleSections.map((s) =>
                renderSection(s, expanded, toggleExpand, toggleWatch, pendingKeys, groupFor, false),
              )}
            </div>
          ) : null}
        </div>
      ) : (
        visibleSections.map((s) => renderSection(s, expanded, toggleExpand, toggleWatch, pendingKeys, groupFor, true))
      )}
    </div>
  );
}

function renderSection(
  section: FeedSectionResult,
  expanded: Set<string>,
  toggleExpand: (id: string) => void,
  toggleWatch: (item: FeedItem) => void,
  pendingKeys: Set<string>,
  groupFor: (item: FeedItem) => { count: number; href?: string },
  defaultOpen: boolean,
) {
  const accent = SOURCE_ACCENT[section.id] ?? "text-[#8b949e] border-[#30363d]";
  const isExpanded = expanded.has(section.id);
  const items = isExpanded ? section.items : section.items.slice(0, DEFAULT_LIMIT);
  const extraCount = section.items.length - items.length;

  return (
    <div key={section.id} className="min-w-0">
      <CollapsiblePanel
        title={<span className={"border-l-2 pl-2 " + accent}>{section.title}</span>}
        subtitle={`${section.fetchedAt ? `${fmtUpdated(section.fetchedAt)} · ` : ""}${section.count} 条`}
        defaultOpen={defaultOpen}
        titleClassName="text-base font-semibold"
      >
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-[#8b949e]">该板块暂无条目</p>
        ) : (
          <div className="-mx-4 -mt-2">
            {items.map((it) => {
              const g = groupFor(it);
              return (
                <FeedCard
                  key={it.key}
                  item={it}
                  onToggleWatch={toggleWatch}
                  watchPending={pendingKeys.has(it.key)}
                  groupCount={g.count}
                  groupHref={g.href}
                  extraAction={it.source === "github" ? <CompareButton fullName={it.sourceId} /> : undefined}
                />
              );
            })}
          </div>
        )}

        {extraCount > 0 ? (
          <button
            type="button"
            onClick={() => toggleExpand(section.id)}
            className="mt-2 w-full rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-[#58a6ff] transition-colors hover:bg-[#21262d]"
          >
            {isExpanded ? "收起" : `显示全部 ${section.count} 条`}
          </button>
        ) : null}
      </CollapsiblePanel>
    </div>
  );
}
