// /hn —— Hacker News 垂直（Phase 3）：服务端直读 data/sources/hackernews/latest.json。
// 只展示标题/分数/评论/时间并外链 HN；不判读、不抓评论、不走 AI（控 token）。
import Link from "next/link";
import type { SourceItem } from "@/core/domain/types";
import { readSourceLatest } from "@/core/store/file";
import { itemHrefFor } from "@/core/analysis/profile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface HnLatest {
  source: string;
  fetched_at: string;
  date: string;
  items: SourceItem[];
}

function metric(item: SourceItem, name: string): number {
  return item.metrics.find((m) => m.name === name)?.value ?? 0;
}

function fmtTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function HnPage() {
  const latest = await readSourceLatest<HnLatest>("hackernews");

  if (!latest || !latest.items?.length) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-4 text-2xl font-semibold text-[#e6edf3]">Hacker News 今日</h1>
        <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-10 text-center">
          <p className="text-[#e6edf3]">暂无数据</p>
          <p className="mt-2 text-sm text-[#8b949e]">
            运行{" "}
            <code className="rounded bg-[#21262d] px-1.5 py-0.5 text-[#ff6600]">node dist/cli/run-source.mjs hackernews</code>{" "}
            拉取 HN 首页后显示
          </p>
        </div>
      </div>
    );
  }

  const fetched = latest.fetched_at ? new Date(latest.fetched_at).toLocaleString("zh-CN") : latest.date;
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold text-[#e6edf3]">Hacker News 首页</h1>
        <span className="text-xs text-[#8b949e]">更新于 {fetched} · {latest.items.length} 条</span>
      </div>
      <ol className="divide-y divide-[#21262d] rounded-lg border border-[#30363d] bg-[#161b22]">
        {latest.items.map((item, i) => {
          const points = metric(item, "points");
          const comments = metric(item, "num_comments");
          return (
            <li key={`${item.source_id}`} className="flex gap-3 px-4 py-3">
              <span className="w-6 shrink-0 pt-0.5 text-right text-sm tabular-nums text-[#8b949e]">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <Link
                    href={itemHrefFor(item.source, item.source_id) || item.url}
                    className="font-medium text-[#e6edf3] hover:text-[#58a6ff]"
                  >
                    {item.title}
                  </Link>
                  <span className="rounded bg-[#21262d] px-1.5 py-0.5 text-xs text-[#ff6600]">{points} pts</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[#8b949e]">
                  <span>{comments} 评论</span>
                  {item.published_at ? <span>{fmtTime(item.published_at)}</span> : null}
                  <a
                    href={`https://news.ycombinator.com/item?id=${item.source_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-[#58a6ff]"
                  >
                    HN 讨论 ↗
                  </a>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-[#8b949e]">
        数据源：Hacker News（Algolia API）front_page；每日随 <code className="text-[#58a6ff]">node dist/cli/daily.mjs</code> 自动刷新，
        亦可手动 <code className="text-[#58a6ff]">node dist/cli/run-source.mjs hackernews</code>。
      </p>
    </div>
  );
}
