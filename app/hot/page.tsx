// /hot —— GitHub 热榜（存量榜）：读 data/hot/latest.json 快照（每日重建），映射为 FeedItem 交 HotBoard。
// 服务端只读已落库快照、映射判读 chips + 关注态（零 AI / 零拉取）；交互（分类 Tab / 只看关注 / 重建）在 HotBoard。
// 与首页「今日增量流」口径不同：本页是按类目查询式实拉的「存量」总 star 榜，独立页面不混。
import Link from "next/link";
import { readHotLatest } from "@/core/store/file";
import { hotRepoToFeedItem, watchedKeySet } from "@/core/analysis/feed";
import { HotBoard, type HotSection } from "@/components/HotBoard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HotPage() {
  const latest = await readHotLatest();

  if (!latest || latest.categories.length === 0) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 pb-16">
        <h1 className="py-4 text-2xl font-bold text-[#e6edf3]">GitHub 热榜</h1>
        <div className="mt-4 rounded-lg border border-[#30363d] bg-[#161b22] p-10 text-center">
          <p className="text-[#e6edf3]">还没有热榜数据</p>
          <p className="mt-3 text-sm leading-relaxed text-[#8b949e]">
            先确认类目查询式已配置（<code className="text-[#58a6ff]">data/config/hot-categories.json</code>），再构建并运行采集器：
          </p>
          <pre className="mx-auto mt-3 w-fit rounded bg-[#0d1117] px-4 py-3 text-left text-xs text-[#e6edf3]">
{`npm run build:cli
node dist/cli/hot.mjs probe     # 先看各类目召回体检报告
node dist/cli/hot.mjs rebuild   # 满意后落榜`}
          </pre>
          <p className="mt-4 text-xs text-[#8b949e]">
            或返回{" "}
            <Link href="/" className="text-[#58a6ff] hover:underline">
              技术热点追踪
            </Link>
          </p>
        </div>
      </main>
    );
  }

  const watched = await watchedKeySet();
  const sections: HotSection[] = latest.categories.map((cat) => ({
    id: cat.id,
    label: cat.label,
    items: cat.items.map((repo) => hotRepoToFeedItem(repo, latest.date, watched)),
  }));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#21262d] py-4">
        <div>
          <h1 className="text-xl font-bold text-[#e6edf3]">GitHub 热榜</h1>
          <p className="mt-0.5 text-xs text-[#8b949e]">按类目查询式实拉的存量榜 · 总 star 降序 · 与首页「今日增量」口径不同</p>
        </div>
      </header>
      <HotBoard sections={sections} filtered={latest.filtered} updatedAt={latest.updated_at} date={latest.date} />
    </main>
  );
}
