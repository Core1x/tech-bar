// /hn/[id] —— Hacker News 条目本地详情页（Phase 5 D；分派框架 + 本地详情，不抓评论正文）。
// 读本地 data/sources/hackernews/latest.json 的该 objectID（含本次快照在列才有）；无则 404。
// 展示：标题（外链原文）/points/评论数/时间/story 正文描述（若有）/HN 讨论链接。不做判读 chips、不走 AI。
import Link from "next/link";
import { notFound } from "next/navigation";
import type { SourceItem } from "@/core/domain/types";
import { readSourceLatest } from "@/core/store/file";

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

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `HN #${id} · 技术信息聚合站`, description: "Hacker News 条目详情" };
}

export default async function HnDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const latest = await readSourceLatest<HnLatest>("hackernews");
  const item = latest?.items.find((i) => i.source_id === id);

  if (!item) {
    // 不在今日快照 → 真正的 404（由 app/not-found 渲染）
    notFound();
  }

  const points = metric(item, "points");
  const comments = metric(item, "num_comments");
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-4 flex items-center gap-2 text-sm text-[#8b949e]">
        <Link href="/hn" className="hover:text-[#58a6ff]">
          Hacker News
        </Link>
        <span>/</span>
        <span>条目 #{id}</span>
      </div>

      <h1 className="text-2xl font-semibold text-[#e6edf3]">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:text-[#58a6ff]">
          {item.title}
        </a>
      </h1>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#8b949e]">
        <span className="rounded bg-[#21262d] px-1.5 py-0.5 text-[#ff6600]">{points} pts</span>
        <span>{comments} 评论</span>
        {item.published_at ? <span>{fmtTime(item.published_at)}</span> : null}
        <span className="text-xs">收录于 {item.discovered_at} 快照</span>
      </div>

      {item.description ? (
        <div className="mt-4 rounded-lg border border-[#30363d] bg-[#161b22] p-4 text-sm text-[#e6edf3]">
          {/* story 正文/链接（HN story_text 可能含 HTML 片段）——剥离标签后按纯文本安全展示 */}
          {item.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-[#58a6ff] hover:border-[#58a6ff]"
        >
            阅读原文 ↗
        </a>
        <a
          href={`https://news.ycombinator.com/item?id=${item.source_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-[#58a6ff] hover:border-[#58a6ff]"
        >
          HN 讨论 ↗
        </a>
      </div>
    </div>
  );
}
