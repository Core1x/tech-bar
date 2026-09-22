// 首页（M1 起的结构，product-optimization-plan §7.2）：
//   ① 页面标题/数据时间/更新按钮 → ② 「今日必须看」简报（默认展开；确定性选择+AI 解释，内含完整跨源综述并入区）
//   → ③ 「异常变化」（仅在有值得注意的确定性变化时出现）→ ④ 完整信息流（FeedBoard，各板块默认收起，保留下钻核对入口）。
// 服务端直读 buildFeed + peekBriefing + collectAnomalies（全本地文件，零 AI / 零拉取 / 零 token）；
// 交互（简报 AI 推荐语生成 / 关注 / 只看关注 / 源 Tab）由客户端组件承担。
import Link from "next/link";
import Image from "next/image";
import { buildFeed } from "@/core/analysis/feed";
import { peekBriefing } from "@/core/analysis/briefing";
import { collectAnomalies } from "@/core/analysis/anomalies";
import { readLatest } from "@/core/store/file";
import { readFeatures } from "@/core/config/features";
import { localDateStr } from "@/core/domain/calendar";
import { createDeepSeekProvider } from "@/core/ai/provider";
import { FeedBoard } from "@/components/FeedBoard";
import { FeedSummary } from "@/components/FeedSummary";
import { BriefingSection } from "@/components/BriefingSection";
import { UpdateButton } from "@/components/UpdateButton";

export const dynamic = "force-dynamic";

/** "2026-09-08T09:00:02+08:00" → "2026-09-08 09:00"（按本地时区，避免跨源格式混排） */
function formatUpdatedAt(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const ANOMALY_TONE: Record<string, string> = {
  accelerate: "border-[#3fb950]/40 bg-[#3fb950]/10 text-[#3fb950]",
  cool: "border-[#8b949e]/40 bg-[#21262d] text-[#8b949e]",
  archived: "border-[#f85149]/40 bg-[#f85149]/10 text-[#f85149]",
  license: "border-[#d29922]/40 bg-[#d29922]/10 text-[#d29922]",
  "source-stale": "border-[#d29922]/40 bg-[#d29922]/10 text-[#d29922]",
};

export default async function Home() {
  const date = localDateStr();
  const sections = await buildFeed();
  const githubLatest = await readLatest();
  const times = sections.map((s) => s.fetchedAt).filter((x): x is string => !!x);
  const latestTime = times.length ? times.sort((a, b) => Date.parse(b) - Date.parse(a))[0] : null;
  const total = sections.reduce((n, s) => n + s.count, 0);
  // 跨源综述 / 简报推荐语 auto 门控：功能开关开启 且 已配 AI key（无 key 回落为点按/模板理由）
  const features = await readFeatures();
  const hasAiKey = await createDeepSeekProvider().hasKey();
  const autoCrossDigest = Boolean(features.autoCrossDigest) && hasAiKey;
  const autoBriefing = Boolean(features.autoBriefing) && hasAiKey;
  // 简报与异常变化：全确定性服务端直出（复用同一次 buildFeed 结果，不重复读盘）
  const briefing = await peekBriefing(date, sections);
  const anomalies = await collectAnomalies(sections, date);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16">
      {/* 顶栏 */}
      <header className="flex items-center justify-between border-b border-[#21262d] py-4">
        <div className="flex items-center gap-3">
          {/* 主 logo（黑色几何标，浅色圆角容器保证暗色下可见） */}
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e6edf3] shadow-md">
            <Image src="/logo.png" alt="技术信息聚合站" width={28} height={28} className="h-7 w-7" priority />
          </span>
          <div>
            <h1 className="text-xl font-bold text-[#e6edf3]">技术信息聚合站</h1>
            {latestTime ? (
              <p className="mt-0.5 text-xs text-[#8b949e]">
                各源数据更新至 {formatUpdatedAt(latestTime)} · 今日 {total} 条
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <UpdateButton />
          <Link
            href="/digest"
            className="rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-[#58a6ff] transition-colors hover:border-[#58a6ff]"
          >
            每日洞察 →
          </Link>
        </div>
      </header>

      {/* 今日必须看：≤5 条候选 + 一句理由 + 可核实依据；完整跨源综述并入其底部（不再独立抢结构） */}
      <BriefingSection initial={briefing} hasKey={hasAiKey} auto={autoBriefing}>
        <FeedSummary auto={autoCrossDigest} hasKey={hasAiKey} />
      </BriefingSection>

      {/* 异常变化：只报真正需要注意的（关注加减速/归档/许可/源过期）；无变化不渲染空面板 */}
      {anomalies.length > 0 ? (
        <section className="mt-4 rounded-lg border border-[#30363d] bg-[#161b22] px-4 py-3" aria-label="异常变化">
          <p className="mb-2 text-xs font-semibold text-[#8b949e]">异常变化 · 需要留意</p>
          <ul className="space-y-1.5">
            {anomalies.slice(0, 6).map((a) => (
              <li key={a.kind + a.ref} className="flex items-start gap-2">
                <span
                  className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${ANOMALY_TONE[a.kind] ?? ANOMALY_TONE.cool}`}
                >
                  {a.kind === "accelerate" ? "加速" : a.kind === "cool" ? "降温" : a.kind === "archived" ? "归档" : a.kind === "license" ? "许可" : "源"}
                </span>
                <span className="min-w-0 text-xs text-[#c9d1d9]">{a.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 完整信息流（保留原貌的下钻/核对入口；各板块默认收起） */}
      <FeedBoard sections={sections} githubLatest={githubLatest} />
    </main>
  );
}
