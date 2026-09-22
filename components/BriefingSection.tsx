"use client";
// M1「今日必须看」简报卡：默认展开，≤5 条候选（确定性选择与服务端直出，本组件只做交互增量）。
// 每条：打开（站内详情/原文）· 关注 · 一句"为什么今天值得看"（AI 或模板降级）· 1-3 条可核实依据 · 风险标签。
// AI 推荐语状态遵循 M0.2 七态口径：未生成→「AI 写推荐语」按钮；数据已更新→蓝条「可重新生成」；
// 生成失败→红条可重试（模板理由兜底，简报不被 AI 阻塞）。auto 且未生成时挂载自动补齐一次（StrictMode 守卫）。
// 完整跨源综述（原首页大段 FeedSummary）并入本卡底部（children），不再独立抢结构。
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { BriefingItemView, BriefingResponse } from "@/core/analysis/briefing";
import { postWatchToggle } from "./watchApi";
import { CompareButton } from "./CompareButton";
import { AiUnavailableNotice } from "./AiUnavailableNotice";
import { fmtIsoShort } from "./ArtifactProvenance";
import { usePersistedOpen } from "./AiCollapseRow";

const RANK_COLORS = ["#e3b341", "#d8a373", "#8b949e", "#8b949e", "#8b949e"];
const SOURCE_BADGE: Record<string, string> = {
  github: "bg-[#58a6ff]/15 text-[#58a6ff]",
  hackernews: "bg-[#ff6600]/15 text-[#ff6600]",
  juejin: "bg-[#1e80ff]/15 text-[#1e80ff]",
  cnblogs: "bg-[#2b7cd3]/15 text-[#2b7cd3]",
};

const TONE: Record<"red" | "amber", string> = {
  red: "border-[#f85149]/40 bg-[#f85149]/10 text-[#f85149]",
  amber: "border-[#d29922]/40 bg-[#d29922]/10 text-[#d29922]",
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden className={`shrink-0 text-[#8b949e] transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
      <path d="M4.47 6.22 8 9.75l3.53-3.53a.75.75 0 1 1 1.06 1.06l-4.06 4.06a.75.75 0 0 1-1.06 0L3.41 7.28a.75.75 0 1 1 1.06-1.06Z" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden className="animate-spin">
      <path d="M8 1.5a6.5 6.5 0 1 1-6.5 6.5.75.75 0 0 1 1.5 0A5 5 0 1 0 8 3a.75.75 0 0 1 0-1.5Z" />
    </svg>
  );
}

export function BriefingSection({
  initial,
  hasKey = true,
  auto = false,
  children,
}: {
  initial: BriefingResponse;
  hasKey?: boolean;
  /** autoBriefing 开且已配 key：未生成时挂载自动补一次 AI 推荐语 */
  auto?: boolean;
  /** 完整跨源综述（FeedSummary）并入区 */
  children?: ReactNode;
}) {
  const [data, setData] = useState<BriefingResponse>(initial);
  // 服务端数据随页面刷新（更新完成 router.refresh / 重新进页）→ render 期同步（React 官方 prop-sync 模式）
  const [prevInitial, setPrevInitial] = useState<BriefingResponse>(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setData(initial);
  }
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [watchState, setWatchState] = useState<Record<string, boolean>>({});
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const autoStartedRef = useRef(false);
  // 默认展开（§7.2），用户收起过则记住偏好
  const [open, toggleOpen] = usePersistedOpen("briefing:today", true);

  const items = data.items;
  const generated = data.generated && data.freshness === "fresh";

  async function generate() {
    if (busy) return;
    setBusy(true);
    setGenError(null);
    try {
      const res = await fetch("/api/briefing", { method: "POST" });
      const j = (await res.json()) as BriefingResponse & { error?: string };
      if (res.ok && j.ok) {
        setData(j);
      } else {
        setGenError(j.error ?? `生成失败（HTTP ${res.status}）`);
      }
    } catch {
      setGenError("网络异常，生成失败");
    } finally {
      setBusy(false);
    }
  }

  // auto：未生成过 AI 推荐语时挂载补一次（与 autoCrossDigest 同一守窗口径；autoStartedRef 防 StrictMode 双跑）
  useEffect(() => {
    if (auto && hasKey && !autoStartedRef.current && data.items.length > 0 && !data.generated) {
      autoStartedRef.current = true;
      void generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载一次性；重复触发由 autoStartedRef 守卫
  }, [auto, hasKey]);

  async function toggleWatch(it: BriefingItemView, cur: boolean) {
    if (pendingKeys.has(it.key)) return;
    const optimistic = !cur;
    setWatchState((m) => ({ ...m, [it.key]: optimistic }));
    setPendingKeys((p) => new Set(p).add(it.key));
    try {
      const res = await postWatchToggle({
        source: it.source,
        sourceId: it.sourceId,
        title: it.title,
        url: it.url,
        metricLabel: it.metricLabel,
      });
      const j = (await res.json()) as { ok?: boolean; watched?: boolean };
      if (!j.ok || typeof j.watched !== "boolean") setWatchState((m) => ({ ...m, [it.key]: cur }));
    } catch {
      setWatchState((m) => ({ ...m, [it.key]: cur }));
    } finally {
      setPendingKeys((p) => {
        const n = new Set(p);
        n.delete(it.key);
        return n;
      });
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-[#30363d] bg-[#161b22]" aria-label="今日必须看">
      {/* 标题行 */}
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-[#1c2129]"
      >
        <Chevron open={open} />
        <span className="text-sm font-semibold text-[#e6edf3]">今日必须看</span>
        <span className="hidden rounded-full bg-[#21262d] px-2 py-0.5 text-[10px] text-[#8b949e] sm:inline">
          确定性筛选 · AI 解释
        </span>
        <span
          className={`ml-auto flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
            busy
              ? "border-[#58a6ff]/40 bg-[#58a6ff]/10 text-[#58a6ff]"
              : genError
                ? "border-[#f85149]/40 bg-[#f85149]/10 text-[#f85149]"
                : data.freshness === "stale"
                  ? "border-[#58a6ff]/40 bg-[#58a6ff]/10 text-[#58a6ff]"
                  : generated
                    ? "border-[#3fb950]/40 bg-[#3fb950]/10 text-[#3fb950]"
                    : "border-[#30363d] bg-[#21262d] text-[#8b949e]"
          }`}
        >
          {busy ? <Spinner /> : null}
          <span className="truncate">
            {busy
              ? "生成中…"
              : genError
                ? "生成失败 · 可重试"
                : data.freshness === "stale"
                  ? "数据已更新 · 可重新生成"
                  : generated
                    ? "已生成 · 基于最新数据"
                    : hasKey
                      ? "AI 推荐语未生成"
                      : "模板理由"}
          </span>
        </span>
        <span className="shrink-0 text-xs text-[#8b949e]">{open ? "收起" : "展开"}</span>
      </button>

      {open && (
        <div className="border-t border-[#21262d] px-4 pb-3 pt-2">
          {/* 数据时间与 AI 生成时间（§12.1 统一语义） */}
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#8b949e]">
            <span>数据更新于 {fmtIsoShort(data.sourceUpdatedAt)}</span>
            {generated && data.generatedAt ? <span>推荐语生成于 {fmtIsoShort(data.generatedAt)}</span> : null}
            {hasKey && !busy ? (
              <button
                onClick={generate}
                className={`underline decoration-dotted underline-offset-2 transition-colors hover:text-[#58a6ff] ${
                  data.freshness === "stale" ? "text-[#58a6ff]" : ""
                }`}
              >
                {generated || data.freshness === "stale" ? "重新生成推荐语" : "用 AI 写推荐语"}
              </button>
            ) : null}
          </div>

          {data.note ? (
            <div className="mb-2 rounded-md border border-[#d29922]/40 bg-[#d29922]/10 px-3 py-2 text-xs text-[#d29922]">
              {data.note}
            </div>
          ) : null}

          {genError ? (
            <div className="mb-2 rounded-md border border-[#f85149]/40 bg-[#f85149]/10 px-3 py-2 text-xs text-[#f85149]">
              {genError}（推荐语暂以确定性理由展示）
            </div>
          ) : data.freshness === "stale" ? (
            <div className="mb-2 rounded-md border border-[#58a6ff]/40 bg-[#58a6ff]/10 px-3 py-2 text-xs text-[#58a6ff]">
              数据已更新，以下 AI 推荐语仍基于旧一版候选（条目与数字为当前值，可信）。
            </div>
          ) : null}

          {items.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-[#8b949e]">今日暂无达标候选（信号不足或数据未更新）。</p>
              <p className="mt-1.5 text-xs text-[#8b949e]">
                点顶栏「立即更新」拉取各源数据后自动出现；也可在下方完整信息流逐源浏览。
              </p>
            </div>
          ) : (
            <ol className="divide-y divide-[#21262d]">
              {items.map((it, i) => {
                const watched = watchState[it.key] ?? it.watched;
                const pending = pendingKeys.has(it.key);
                return (
                  <li key={it.key} className="flex items-start gap-3 py-3">
                    {/* 名次点 */}
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: RANK_COLORS[i] ?? "#8b949e" }} aria-hidden />
                    {/* 关注按钮（与全站 watchlist 一致） */}
                    <button
                      type="button"
                      onClick={() => toggleWatch(it, watched)}
                      disabled={pending}
                      title={watched ? "取消关注" : "加入关注"}
                      aria-label={watched ? "取消关注" : "加入关注"}
                      className={
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-sm transition-colors " +
                        (watched
                          ? "border-[#e3b341]/50 bg-[#e3b341]/15 text-[#e3b341]"
                          : "border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#e6edf3]") +
                        (pending ? " cursor-wait opacity-60" : "")
                      }
                    >
                      {watched ? "★" : "☆"}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + (SOURCE_BADGE[it.source] ?? "bg-[#30363d]/40 text-[#8b949e]")}>
                          {it.sourceLabel}
                        </span>
                        <Link href={it.detailHref} className="min-w-0 break-all font-medium text-[#e6edf3] hover:text-[#58a6ff]">
                          {it.title}
                        </Link>
                        <a
                          href={it.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          aria-label="打开原文"
                          title="打开原文（新标签页）"
                          className="text-[#8b949e] transition-colors hover:text-[#58a6ff]"
                        >
                          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden>
                            <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm8.054-.28a.75.75 0 0 1 .476.216l.03.029a.75.75 0 0 1 .19.515v.01l-.001 4.5a.75.75 0 0 1-1.5 0V4.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06l3.22-3.22H9.75a.75.75 0 0 1 0-1.5h1.82a.75.75 0 0 1 .234.03Z" />
                          </svg>
                        </a>
                        {it.metricLabel ? <span className="font-semibold tabular-nums text-[#e6edf3]">{it.metricLabel}</span> : null}
                        {it.secondary ? <span className="tabular-nums text-xs text-[#8b949e]">{it.secondary}</span> : null}
                        {it.groupCount >= 2 ? (
                          <span className="rounded bg-[#e3b341]/15 px-1.5 py-0.5 text-[11px] text-[#e3b341]">
                            同主题跨源 ×{it.groupCount}
                            {it.groupHref ? (
                              <Link href={it.groupHref} className="ml-1 underline hover:text-[#58a6ff]">
                                看另一源
                              </Link>
                            ) : null}
                          </span>
                        ) : null}
                        {/* 加入对比（§7.3：非 GitHub 条目不显示） */}
                        {it.source === "github" ? <CompareButton fullName={it.sourceId} /> : null}
                      </div>

                      {/* 一句"为什么今天值得看" */}
                      <p className="mt-1 text-sm text-[#c9d1d9]">
                        <span className="mr-1.5 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 text-[10px] text-[#8b949e]">
                          {it.reasonSource === "ai" ? "为什么值得看" : "理由"}
                        </span>
                        {it.reason}
                      </p>

                      {/* 可核实依据 + 风险标签 */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {it.evidence.map((e) => (
                          <span key={e} className="rounded-full border border-[#30363d] bg-[#0d1117] px-2 py-0.5 text-[11px] text-[#8b949e]">
                            {e}
                          </span>
                        ))}
                        {it.risk.map((r) => (
                          <span key={r.label} className={`rounded-full border px-2 py-0.5 text-[11px] ${TONE[r.tone]}`}>
                            {r.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {/* 原「今日跨源值得看」并入：不再以独立大段 Markdown 抢首页结构 */}
          {children ? (
            <div className="mt-3 border-t border-[#21262d] pt-3">
              {children}
            </div>
          ) : null}
          {!hasKey && items.length > 0 ? (
            <div className="mt-2">
              <AiUnavailableNotice what="AI 推荐语（当前为确定性模板理由）" />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
