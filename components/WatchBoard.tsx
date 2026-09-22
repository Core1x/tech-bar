"use client";
// 关注中心看板（M2 §8.2）：类型过滤（全部/GitHub/文章）、排序（最近变化/最近关注/名称）、
// 每行原生指标 + 关注时间 + 最近变化摘要 + 取消关注；空态解释加入路径并给返回入口。
// 数据由服务端 /watch 装配（watchlist × 今日 feed × tracked 合并，状态：live/offlist/sampling/stale/legacy）。
import Link from "next/link";
import { useMemo, useState } from "react";
import { postWatchToggle } from "./watchApi";

export interface WatchRow {
  key: string;
  source: string;
  sourceId: string;
  isGithub: boolean;
  title: string;
  url: string;
  detailHref: string;
  description: string | null;
  /** 当前/最后已知原生度量（如 ★ 12,345 / 455 赞）；可能为 null（legacy 无快照） */
  metric: string | null;
  /** GitHub 今日新增（有值才显示涨跌） */
  delta: number | null;
  /** 最近变化摘要（一句话，服务端确定性生成） */
  change: string;
  /** 今日是否有变化（在榜/新增/采样成功） */
  changedToday: boolean;
  /** live=今日在榜；offlist=已离榜用快照；sampling=新关注待采样；stale=限流回退 last-known；legacy=旧记录无快照 */
  status: "live" | "offlist" | "sampling" | "stale" | "legacy";
  addedAt: string;
  capturedAt: string | null;
}

const STATUS_BADGE: Record<WatchRow["status"], { label: string; cls: string } | null> = {
  live: null,
  offlist: { label: "已离榜", cls: "border-[#8b949e]/40 bg-[#21262d] text-[#8b949e]" },
  sampling: { label: "待采样", cls: "border-[#58a6ff]/40 bg-[#58a6ff]/10 text-[#58a6ff]" },
  stale: { label: "最后已知", cls: "border-[#d29922]/40 bg-[#d29922]/10 text-[#d29922]" },
  legacy: { label: "历史关注", cls: "border-[#30363d] bg-[#21262d] text-[#8b949e]" },
};

type Filter = "all" | "github" | "article";
type Sort = "changed" | "added" | "name";

function fmtAdded(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function WatchBoard({
  rows,
  total,
  changedToday,
  dataUpdatedAt,
}: {
  rows: WatchRow[];
  total: number;
  changedToday: number;
  dataUpdatedAt: string | null;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("changed");
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    let list = rows.filter((r) => !removed.has(r.key));
    if (filter === "github") list = list.filter((r) => r.isGithub);
    if (filter === "article") list = list.filter((r) => !r.isGithub);
    const cmp: Record<Sort, (a: WatchRow, b: WatchRow) => number> = {
      changed: (a, b) =>
        Number(b.changedToday) - Number(a.changedToday) ||
        Date.parse(b.capturedAt ?? b.addedAt) - Date.parse(a.capturedAt ?? a.addedAt),
      added: (a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt),
      name: (a, b) => a.title.localeCompare(b.title, "zh-CN"),
    };
    return [...list].sort(cmp[sort]);
  }, [rows, removed, filter, sort]);

  async function unfollow(r: WatchRow) {
    if (pending.has(r.key)) return;
    setPending((p) => new Set(p).add(r.key));
    setError(null);
    // 乐观隐藏（取消关注是移除操作；失败回滚显示）
    setRemoved((s) => new Set(s).add(r.key));
    try {
      const res = await postWatchToggle({ source: r.source, sourceId: r.sourceId, title: r.title, url: r.url, metricLabel: r.metric });
      const j = (await res.json()) as { ok?: boolean; watched?: boolean; error?: string };
      if (!j.ok) setRemoved((s) => { const n = new Set(s); n.delete(r.key); return n; });
      else if (j.watched === true) setRemoved((s) => { const n = new Set(s); n.delete(r.key); return n; }); // 竞态：又被加了回来
    } catch {
      setRemoved((s) => { const n = new Set(s); n.delete(r.key); return n; });
      setError("网络错误，取消关注失败");
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(r.key); return n; });
    }
  }

  return (
    <>
      <header className="flex items-center justify-between border-b border-[#21262d] py-4">
        <div>
          <h1 className="text-xl font-bold text-[#e6edf3]">关注中心</h1>
          <p className="mt-0.5 text-xs text-[#8b949e]">
            {total} 个关注 · 今日有变化 {changedToday} 个
            {dataUpdatedAt ? ` · 数据更新于 ${fmtAdded(dataUpdatedAt)}` : ""}
          </p>
        </div>
        <Link href="/" className="rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-[#58a6ff] transition-colors hover:border-[#58a6ff]">
          ← 聚合信息流
        </Link>
      </header>

      {/* 过滤 + 排序 */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-md border border-[#30363d] bg-[#161b22] p-1">
          {(
            [
              ["all", "全部"],
              ["github", "GitHub"],
              ["article", "文章"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                filter === k ? "bg-[#30363d] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-[#8b949e]">
          排序
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-sm text-[#e6edf3] outline-none transition-colors focus:border-[#58a6ff]"
          >
            <option value="changed">最近变化</option>
            <option value="added">最近关注</option>
            <option value="name">名称</option>
          </select>
        </label>
      </div>

      {error ? <p className="mt-3 text-xs text-[#f85149]">{error}</p> : null}

      {/* 列表 */}
      {visible.length === 0 ? (
        <div className="mt-6 rounded-lg border border-[#30363d] bg-[#161b22] p-10 text-center">
          <p className="text-[#e6edf3]">{total === 0 ? "还没有关注任何条目" : "该过滤条件下暂无条目"}</p>
          {total === 0 ? (
            <>
              <p className="mt-2 text-sm text-[#8b949e]">
                在「聚合信息流」「GitHub 热榜」或仓库详情页点 ☆ 加入关注，这里会持续跟踪它们的变化
                （GitHub 关注仓库会自动进入每日趋势采样）。
              </p>
              <div className="mt-4 flex justify-center gap-3">
                <Link href="/" className="rounded-md bg-[#238636] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2ea043]">
                  去聚合信息流
                </Link>
                <Link href="/hot" className="rounded-md border border-[#30363d] px-4 py-2 text-sm text-[#58a6ff] transition-colors hover:border-[#58a6ff]">
                  去 GitHub 热榜
                </Link>
              </div>
            </>
          ) : (
            <button onClick={() => setFilter("all")} className="mt-3 text-sm text-[#58a6ff] underline">
              查看全部关注
            </button>
          )}
        </div>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {visible.map((r) => {
            const badge = STATUS_BADGE[r.status];
            return (
              <li key={r.key} className="rounded-lg border border-[#30363d] bg-[#161b22] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link href={r.detailHref} className="break-all font-medium text-[#e6edf3] hover:text-[#58a6ff]">
                        {r.title}
                      </Link>
                      <span className="rounded bg-[#21262d] px-1.5 py-0.5 text-[10px] text-[#8b949e]">
                        {r.isGithub ? "GitHub" : "文章"}
                      </span>
                      {badge ? (
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${badge.cls}`}>{badge.label}</span>
                      ) : null}
                      {r.metric ? <span className="font-semibold tabular-nums text-[#e6edf3] text-sm">{r.metric}</span> : null}
                      {r.delta !== null && r.delta > 0 ? (
                        <span className="tabular-nums text-xs text-[#3fb950]">↑+{r.delta.toLocaleString("en-US")}</span>
                      ) : null}
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer noopener" className="text-xs text-[#8b949e] hover:text-[#58a6ff]" aria-label="打开原文">
                          原文 ↗
                        </a>
                      ) : null}
                    </div>
                    {r.description ? <p className="mt-1 line-clamp-2 text-sm text-[#8b949e]">{r.description}</p> : null}
                    <p className="mt-1.5 text-xs text-[#8b949e]">
                      <span className={r.changedToday ? "text-[#3fb950]" : ""}>{r.change}</span>
                      <span className="mx-1.5 text-[#30363d]">|</span>
                      关注于 {fmtAdded(r.addedAt)}
                    </p>
                  </div>
                  <button
                    onClick={() => unfollow(r)}
                    disabled={pending.has(r.key)}
                    title="取消关注"
                    aria-label={`取消关注 ${r.title}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#e3b341]/50 bg-[#e3b341]/15 text-sm text-[#e3b341] transition-colors hover:bg-[#e3b341]/25 disabled:opacity-50"
                  >
                    {pending.has(r.key) ? "…" : "★"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
