"use client";
// GitHub 热榜看板（/hot 存量榜）：分类 tab 横切 + 卡片列表（复用 FeedCard：源码徽标/★总star/forks/判读chips/关注）
// +「只看关注」过滤 + 出榜记录面板（技术性原因可见）。数据全部服务端预映射为 FeedItem（零客户端拉取/AI）。
// 关注切换打 /api/watchlist（source=github，与聚合首页共用同一跨源关注表），乐观更新、失败回滚。
import { useMemo, useState } from "react";
import type { FeedItem, HotFilteredEntry } from "@/core/domain/types";
import { FeedCard } from "./FeedCard";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { HotRebuildButton } from "./HotRebuildButton";
import { CompareButton } from "./CompareButton";
import { postWatchToggle, watchSnapshotOf } from "./watchApi";

const DEFAULT_LIMIT = 20;

export interface HotSection {
  id: string;
  label: string;
  items: FeedItem[];
}

function fmtUpdated(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function HotBoard({
  sections,
  filtered,
  updatedAt,
  date,
}: {
  sections: HotSection[];
  filtered: HotFilteredEntry[];
  updatedAt: string;
  date: string;
}) {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "");
  const [watchedOnly, setWatchedOnly] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [watchState, setWatchState] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const s of sections) for (const it of s.items) m[it.key] = it.watched;
    return m;
  });
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const active = sections.find((s) => s.id === activeId) ?? sections[0];

  const items = useMemo(() => {
    if (!active) return [];
    const mapped = active.items.map((it) => ({ ...it, watched: watchState[it.key] ?? it.watched }));
    return watchedOnly ? mapped.filter((it) => it.watched) : mapped;
  }, [active, watchedOnly, watchState]);

  const shown = expanded ? items : items.slice(0, DEFAULT_LIMIT);
  const totalKept = sections.reduce((n, s) => n + s.items.length, 0);

  async function toggleWatch(item: FeedItem) {
    if (pendingKeys.has(item.key)) return;
    const prev = watchState[item.key] ?? item.watched;
    setPendingKeys((p) => new Set(p).add(item.key));
    setError(null);
    setWatchState((m) => ({ ...m, [item.key]: !prev }));
    try {
      const res = await postWatchToggle(watchSnapshotOf(item));
      const json = (await res.json()) as { ok?: boolean; watched?: boolean; error?: string };
      if (!json.ok || typeof json.watched !== "boolean") {
        setWatchState((m) => ({ ...m, [item.key]: prev }));
        setError(json?.error || "切换关注失败");
      }
    } catch {
      setWatchState((m) => ({ ...m, [item.key]: prev }));
      setError("网络错误，切换关注失败");
    } finally {
      setPendingKeys((p) => {
        const n = new Set(p);
        n.delete(item.key);
        return n;
      });
    }
  }

  return (
    <div className="mt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {/* 分类 tab（横切） */}
        <div className="flex flex-wrap gap-1 rounded-md border border-[#30363d] bg-[#161b22] p-1">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setActiveId(s.id);
                setExpanded(false);
              }}
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                activeId === s.id ? "bg-[#30363d] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"
              }`}
            >
              {s.label}
              <span className="ml-1 text-xs text-[#8b949e]">{s.items.length}</span>
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
            {watchedOnly ? "★" : "☆"} 只看关注
          </button>
          <HotRebuildButton />
        </div>
      </div>

      {/* 当前分类卡片列表 */}
      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-[#8b949e]">{watchedOnly ? "该分类暂无已关注项目" : "该分类暂无入榜项目"}</p>
      ) : (
        <div className="rounded-lg border border-[#30363d] bg-[#0d1117]">
          {shown.map((it) => (
            <FeedCard key={it.key} item={it} onToggleWatch={toggleWatch} watchPending={pendingKeys.has(it.key)} extraAction={<CompareButton fullName={it.sourceId} />} />
          ))}
        </div>
      )}

      {items.length > DEFAULT_LIMIT ? (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 w-full rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-[#58a6ff] transition-colors hover:bg-[#21262d]"
        >
          {expanded ? "收起" : `显示该分类全部 ${items.length} 条`}
        </button>
      ) : null}

      {/* 出榜记录（技术性过滤原因可见，可交代） */}
      {filtered.length > 0 ? (
        <div className="mt-6">
          <CollapsiblePanel
            title="已过滤仓库"
            subtitle={`${filtered.length} 条（技术性原因出榜，理由可查）`}
            defaultOpen={false}
            titleClassName="text-sm font-semibold"
          >
            <ul className="divide-y divide-[#21262d] text-sm">
              {filtered.map((f) => (
                <li key={f.full_name} className="flex items-center justify-between gap-3 py-2">
                  <a
                    href={`https://github.com/${f.full_name}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="min-w-0 truncate text-[#8b949e] hover:text-[#58a6ff]"
                    title={f.full_name}
                  >
                    {f.full_name}
                  </a>
                  <span className="shrink-0 rounded bg-[#21262d] px-2 py-0.5 text-xs text-[#d29922]">{f.reason}</span>
                </li>
              ))}
            </ul>
          </CollapsiblePanel>
        </div>
      ) : null}

      <p className="mt-4 text-xs text-[#8b949e]">
        存量榜（按类目查询式实拉、总 star 降序）· 更新至 {fmtUpdated(updatedAt)}（{date}）· 共 {totalKept} 条 · 每日随
        <code className="mx-1 text-[#58a6ff]">node dist/cli/daily.mjs</code>重建，亦可点右上「重建榜单」。
      </p>
    </div>
  );
}
