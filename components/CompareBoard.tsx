"use client";
// M3 对比页看板（§9.5）：从对比篮读取 ≤4 个 GitHub 仓库 → GET /api/compare 事实矩阵（无 AI 也可用）。
// 表格横向滚动（窄屏只滚表格不滚页面）；列头可移出对比篮（联动刷新）；场景输入 → POST 生成
// 「按该场景如何选择」（引用矩阵字段；无 AI Key 时给提示不渲染按钮）。
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CompareRepoData } from "@/core/domain/types";
import { COMPARE_MAX, clearCompare, getCompareServerSnapshot, getCompareSnapshot, removeFromCompare, subscribeCompare } from "./compareStore";
import { AiUnavailableNotice } from "./AiUnavailableNotice";

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("en-US");
}

type RowDef = { label: string; get: (r: CompareRepoData) => React.ReactNode };

const ROWS: RowDef[] = [
  { label: "项目定位", get: (r) => <span className="text-[#c9d1d9]">{r.positioning ?? "（无描述）"}</span> },
  {
    label: "star 与近 7 日增长",
    get: (r) => (
      <span>
        <span className="font-semibold text-[#e6edf3]">★ {fmt(r.stars)}</span>
        {r.deltaToday !== null && r.deltaToday > 0 ? <span className="ml-1.5 text-[#3fb950]">今日 +{fmt(r.deltaToday)}</span> : null}
        {r.growth7d ? (
          <span className="mt-0.5 block text-[11px] text-[#8b949e]">
            {r.growth7d.from} → {r.growth7d.to}：{r.growth7d.delta === null ? "—" : `${r.growth7d.delta >= 0 ? "+" : ""}${fmt(r.growth7d.delta)}`}
            {r.growth7d.note ? ` · ${r.growth7d.note}` : ""}
          </span>
        ) : (
          <span className="mt-0.5 block text-[11px] text-[#8b949e]">样本不足，暂不能判断趋势</span>
        )}
      </span>
    ),
  },
  { label: "fork", get: (r) => fmt(r.forks) },
  { label: "open issues", get: (r) => fmt(r.openIssues) },
  { label: "最后推送", get: (r) => r.pushedAt ?? "未知" },
  { label: "创建时间", get: (r) => r.createdAt ?? "—" },
  {
    label: "许可证",
    get: (r) => (r.licenseKnown ? (r.license && r.license !== "NOASSERTION" ? r.license : <span className="text-[#d29922]">无明确许可证</span>) : <span className="text-[#8b949e]">未知</span>),
  },
  { label: "主要语言", get: (r) => r.language ?? "—" },
  { label: "最新 release", get: (r) => (r.latestRelease ? `${r.latestRelease.tag}${r.latestRelease.publishedAt ? `（${r.latestRelease.publishedAt}）` : ""}` : "未看到正式发布") },
  {
    label: "归档 / 维护风险",
    get: (r) =>
      r.risks.length === 0 ? (
        <span className="text-[#3fb950]">未见硬风险旗</span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {r.risks.map((x) => (
            <span key={x} className="rounded-full border border-[#d29922]/40 bg-[#d29922]/10 px-2 py-0.5 text-[11px] text-[#d29922]">
              {x}
            </span>
          ))}
        </span>
      ),
  },
  {
    label: "部署方式（README）",
    get: (r) =>
      r.deployHints.length > 0 ? (
        <ul className="space-y-1">
          {r.deployHints.map((d) => (
            <li key={d} className="rounded bg-[#0d1117] px-2 py-1 font-mono text-[11px] leading-snug text-[#c9d1d9]">
              {d}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-[#8b949e]">README 未明确提供（或未缓存——先访问详情页）</span>
      ),
  },
];

export function CompareBoard({ hasKey = true }: { hasKey?: boolean }) {
  const basket = useSyncExternalStore(subscribeCompare, getCompareSnapshot, getCompareServerSnapshot);
  const [data, setData] = useState<CompareRepoData[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState("");
  const [advice, setAdvice] = useState<string | null>(null);
  const [adviceBusy, setAdviceBusy] = useState(false);
  const [adviceError, setAdviceError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const reqRef = useRef(0);

  const key = basket.join(",");

  useEffect(() => {
    const id = ++reqRef.current;
    (async () => {
      if (basket.length < 2) {
        setData(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/compare?repos=${encodeURIComponent(basket.join(","))}`);
        const j = (await res.json()) as { ok?: boolean; repos?: CompareRepoData[]; error?: string };
        if (id !== reqRef.current) return;
        if (res.ok && j.ok && j.repos) {
          setData(j.repos);
          setAdvice(null);
        } else {
          setError(j.error ?? `加载失败（HTTP ${res.status}）`);
          setData(null);
        }
      } catch {
        if (id === reqRef.current) setError("网络异常，矩阵加载失败");
      } finally {
        if (id === reqRef.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 以 key/retryTick 变化为准重取（basket 数组每次新建）
  }, [key, retryTick, hasKey]);

  async function ask() {
    const q = scenario.trim();
    if (!q || adviceBusy || !data) return;
    setAdviceBusy(true);
    setAdviceError(null);
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repos: data.map((r) => r.fullName), scenario: q }),
      });
      const j = (await res.json()) as { ok?: boolean; advice?: string; error?: string };
      if (res.ok && j.ok && j.advice) setAdvice(j.advice);
      else setAdviceError(j.error ?? `生成失败（HTTP ${res.status}）`);
    } catch {
      setAdviceError("网络异常，生成失败");
    } finally {
      setAdviceBusy(false);
    }
  }

  return (
    <div>
      {/* 顶栏 */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#21262d] py-4">
        <div>
          <h1 className="text-xl font-bold text-[#e6edf3]">项目对比</h1>
          <p className="mt-0.5 text-xs text-[#8b949e]">
            最多 {COMPARE_MAX} 个 GitHub 仓库并排事实矩阵（无需 AI）；对比篮存本地浏览器 · 已选 {basket.length}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {basket.length > 0 ? (
            <button onClick={clearCompare} className="text-xs text-[#8b949e] underline-offset-2 hover:text-[#f85149] hover:underline">
              清空对比篮
            </button>
          ) : null}
          <Link href="/" className="rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-[#58a6ff] transition-colors hover:border-[#58a6ff]">
            ← 信息流
          </Link>
        </div>
      </header>

      {/* 空态（§12.3：为何为空 + 下一步） */}
      {basket.length === 0 ? (
        <div className="mt-6 rounded-lg border border-[#30363d] bg-[#161b22] p-10 text-center">
          <p className="text-[#e6edf3]">对比篮是空的</p>
          <p className="mt-2 text-sm text-[#8b949e]">在首页「今日必须看」、GitHub 热榜、AI 寻找结果或仓库详情页点「+ 加入对比」（最多 4 个），到这里并排看事实矩阵。</p>
          <div className="mt-4 flex justify-center gap-3">
            <Link href="/" className="rounded-md bg-[#238636] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2ea043]">去今日简报</Link>
            <Link href="/hot" className="rounded-md border border-[#30363d] px-4 py-2 text-sm text-[#58a6ff] transition-colors hover:border-[#58a6ff]">去 GitHub 热榜</Link>
          </div>
        </div>
      ) : basket.length === 1 ? (
        <div className="mt-6 rounded-lg border border-[#30363d] bg-[#161b22] p-8 text-center">
          <p className="text-sm text-[#e6edf3]">已选 1 个：<span className="font-mono">{basket[0]}</span></p>
          <p className="mt-1.5 text-sm text-[#8b949e]">再至少加入 1 个仓库即可对比——去首页简报 / 热榜 / 详情页点「+ 加入对比」。</p>
          <Link href="/" className="mt-3 inline-block text-sm text-[#58a6ff] hover:underline">← 回到哪里都能加的地方</Link>
        </div>
      ) : loading && !data ? (
        <div className="mt-6 space-y-2">
          <div className="h-5 w-1/3 animate-pulse rounded bg-[#21262d]" />
          <div className="h-64 animate-pulse rounded-lg bg-[#21262d]" />
        </div>
      ) : error && !data ? (
        <div className="mt-6 rounded-lg border border-[#f85149]/40 bg-[#f85149]/10 px-4 py-3 text-sm text-[#f85149]">
          {error}
          <button onClick={() => setRetryTick((t) => t + 1)} className="ml-2 underline underline-offset-2 hover:opacity-80">
            重试
          </button>
        </div>
      ) : data ? (
        <>
          <div className="mt-4 overflow-x-auto rounded-lg border border-[#30363d]">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 w-32 shrink-0 border-b border-[#21262d] bg-[#161b22] px-3 py-2.5 text-left align-bottom text-xs font-normal text-[#8b949e]">
                    字段{loading ? <span className="ml-2 inline-block animate-pulse text-[#58a6ff]">刷新中…</span> : null}
                  </th>
                  {data.map((r) => (
                    <th key={r.fullName} className="min-w-[220px] border-b border-l border-[#21262d] bg-[#161b22] px-3 py-2.5 text-left align-top">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/repo/${r.fullName}`} className="break-all font-medium text-[#58a6ff] hover:underline">
                          {r.fullName}
                        </Link>
                        <button
                          onClick={() => removeFromCompare(r.fullName)}
                          className="shrink-0 text-xs text-[#8b949e] hover:text-[#f85149]"
                          title="移出对比篮"
                          aria-label={`移出对比篮 ${r.fullName}`}
                        >
                          ×
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.label}>
                    <th className="sticky left-0 z-10 border-b border-[#21262d] bg-[#161b22] px-3 py-2.5 text-left align-top text-xs font-normal text-[#8b949e]">
                      {row.label}
                    </th>
                    {data.map((r) => (
                      <td key={r.fullName} className="border-b border-l border-[#21262d] px-3 py-2.5 align-top text-[#e6edf3]">
                        {row.get(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 场景选择建议（AI 附加层；矩阵本身零 AI 可用） */}
          <div className="mt-4 rounded-lg border border-[#30363d] bg-[#161b22] p-4">
            <p className="text-sm font-semibold text-[#e6edf3]">按你的场景，怎么选？</p>
            <p className="mt-0.5 text-xs text-[#8b949e]">可选增强：AI 的建议只引用上方矩阵字段，事实以矩阵为准。</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <input
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) void ask();
                }}
                placeholder="例如：团队内网部署、主语言 Rust、要能商用"
                maxLength={300}
                className="min-w-0 flex-1 rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3] placeholder-[#8b949e] outline-none transition-colors focus:border-[#58a6ff]"
              />
              {hasKey ? (
                <button
                  onClick={ask}
                  disabled={adviceBusy || scenario.trim() === ""}
                  className="rounded-md bg-[#238636] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2ea043] disabled:opacity-50"
                >
                  {adviceBusy ? "生成中…" : "生成建议"}
                </button>
              ) : null}
            </div>
            {!hasKey ? <div className="mt-2"><AiUnavailableNotice what="场景选择建议（矩阵可直接人工对比）" /></div> : null}
            {adviceError ? (
              <p className="mt-2 rounded-md border border-[#f85149]/30 bg-[#f85149]/10 px-3 py-2 text-xs text-[#f85149]">{adviceError}</p>
            ) : null}
            {advice ? (
              <p className="mt-3 whitespace-pre-wrap rounded-md border border-[#21262d] bg-[#0d1117] px-3 py-2.5 text-sm leading-relaxed text-[#c9d1d9]">{advice}</p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
