// 详情页「同类项目」区块：默认收起为一行状态条（AiCollapseRow），挂载只 ?peek=1 查缓存回填状态，
// 点开才渲染。未生成时展开区给「AI 找同类」按钮（会检索 GitHub + AI 取舍，消耗 token；结果落缓存）。
// auto=true（功能设置开「详情页自动生成 AI 同类取舍」+ 已配 key）：自动生成延后到**首次展开**时触发。
// M0.2 新鲜度：缓存命中带 freshness（fresh/stale/legacy）+ meta——stale/legacy 显示旧结果 + 重新生成入口；
// 无 key 的实时本地候选不标新鲜度（它就是当前数据）。
"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SimilarResponse } from "@/lib/types";
import type { ArtifactFreshness } from "@/core/domain/artifact";
import { formatStarsCompact } from "@/lib/format";
import { LangDot } from "@/components/LangDot";
import { VerdictChips } from "@/components/VerdictChips";
import { DeltaBadge } from "@/components/RepoRow";
import { AiUnavailableNotice } from "@/components/AiUnavailableNotice";
import { ArtifactNotice, ArtifactProvenance } from "@/components/ArtifactProvenance";
import { CompareButton } from "@/components/CompareButton";
import { AiCollapseRow, usePersistedOpen, type AiRowStatus } from "@/components/AiCollapseRow";

type LoadState = "peeking" | "missing" | "ready" | "error";

export function SimilarProjects({
  repo,
  auto = false,
  hasKey = true,
}: {
  repo: string;
  auto?: boolean;
  /** 是否已配置 AI key；false 时缺缓存处直接提示（不给会报 503 的按钮） */
  hasKey?: boolean;
}) {
  const [state, setState] = useState<LoadState>("peeking");
  const [data, setData] = useState<SimilarResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, toggleOpen] = usePersistedOpen(`aiPanel:${repo}:similar`);
  // 防重复：auto 打开时（含 React StrictMode 开发期双跑 effect）只自动查找一次
  const autoStartedRef = useRef(false);

  // 挂载：探测缓存（不消耗 token、不发搜索）——收起状态下也据此回填状态徽标
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/similar?repo=${encodeURIComponent(repo)}&peek=1`);
        if (res.ok) {
          const j = (await res.json()) as SimilarResponse;
          if (cancelled) return;
          if (j.available === false) {
            setState("missing");
          } else {
            setData(j);
            setState("ready");
          }
        } else {
          let msg = `加载失败（HTTP ${res.status}）`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j?.error) msg = j.error;
          } catch {
            // 非 JSON
          }
          if (!cancelled) {
            setErrorMsg(msg);
            setState("error");
          }
        }
      } catch {
        if (!cancelled) {
          setErrorMsg("网络异常，同类项目加载失败");
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo]);

  // auto 且未缓存：用户**首次展开**才自动查找 + AI 取舍
  useEffect(() => {
    if (auto && hasKey && open && state === "missing" && !autoStartedRef.current) {
      autoStartedRef.current = true;
      void find();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- find 闭包够用；重复触发由 autoStartedRef 守卫
  }, [auto, hasKey, open, state]);

  // 用户点按才搜索 + AI 取舍
  async function find() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/similar?repo=${encodeURIComponent(repo)}`);
      const j = (await res.json()) as SimilarResponse & { error?: string };
      if (res.ok) {
        setData(j);
        setState("ready");
      } else {
        setErrorMsg(j.error ?? `生成失败（HTTP ${res.status}）`);
        setState("error");
      }
    } catch {
      setErrorMsg("网络异常，生成失败");
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  // 新鲜度：仅缓存命中（cached:true）参与三态；实时响应（无 key 本地候选/新生成）即当前数据
  const cachedFreshness: ArtifactFreshness | null = data?.cached
    ? (data.freshness ?? (data.meta ? "fresh" : "legacy"))
    : null;

  const status: AiRowStatus =
    busy || (auto && hasKey && open && state === "missing")
      ? "generating"
      : state === "ready"
        ? data?.genError
          ? "failed"
          : cachedFreshness === "stale"
            ? "stale"
            : cachedFreshness === "legacy"
              ? "legacy"
              : "ready"
        : state === "error"
          ? "failed"
          : state === "peeking"
            ? "checking"
            : !hasKey
              ? "no-key"
              : "missing";

  const similar = data?.similar ?? [];

  return (
    <AiCollapseRow
      title="同类项目 · 对照选型"
      hint={auto ? "自动 · 展开时查找" : "点按查找 · 缓存复用"}
      status={status}
      open={open}
      onToggle={toggleOpen}
    >
      {(state === "peeking" || busy) && (
        <div className="space-y-2 py-1">
          <div className="h-3 w-2/3 animate-pulse rounded bg-[#21262d]" />
          <div className="h-3 w-full animate-pulse rounded bg-[#21262d]" />
          <p className="pt-1 text-xs text-[#8b949e]">
            {busy ? "AI 查找中…（约 10-40 秒，结果会缓存复用）" : "检查缓存…"}
          </p>
        </div>
      )}

      {!busy && state === "missing" &&
        (hasKey ? (
          <div className="py-1">
            <p className="text-sm text-[#8b949e]">同类项目尚未查找</p>
            <button
              onClick={find}
              disabled={busy}
              className="mt-2.5 rounded-md bg-[#238636] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#2ea043] disabled:opacity-50"
            >
              AI 找同类（对照选型）
            </button>
            <p className="mt-1.5 text-[11px] text-[#8b949e]">
              会检索 GitHub 并让 AI 写取舍，消耗一定 token；结果缓存复用
            </p>
          </div>
        ) : (
          <AiUnavailableNotice what="同类项目" />
        ))}

      {!busy && state === "error" && (
        <div className="rounded-md border border-[#f85149]/30 bg-[#f85149]/10 px-3 py-2 text-xs text-[#f85149]">
          {errorMsg}
          <button onClick={find} disabled={busy} className="ml-2 underline disabled:opacity-50">
            重试
          </button>
        </div>
      )}

      {!busy && state === "ready" && (
        <>
          {data?.genError ? (
            <ArtifactNotice kind="failed" error={data.genError} hasKey={hasKey} onRegenerate={find} />
          ) : cachedFreshness === "stale" ? (
            <ArtifactNotice kind="stale" hasKey={hasKey} onRegenerate={find} />
          ) : cachedFreshness === "legacy" ? (
            <ArtifactNotice kind="legacy" hasKey={hasKey} onRegenerate={find} />
          ) : null}
          {similar.length === 0 ? (
          <p className="text-sm text-[#8b949e]">
            暂未找到同类项目（可用「AI 寻找」用一句话描述需求另找）
          </p>
        ) : (
          <div className="space-y-2">
            <ul className="space-y-2">
              {similar.map((item) => {
                return (
                  <li key={item.full_name} className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Link
                            href={`/repo/${item.full_name}`}
                            className="break-all font-medium text-[#58a6ff] hover:underline"
                          >
                            {item.full_name}
                          </Link>
                          {item.language && (
                            <span className="flex items-center gap-1 text-xs text-[#8b949e]">
                              <LangDot language={item.language} />
                              {item.language}
                            </span>
                          )}
                          <span className="text-xs text-[#8b949e]">★ {formatStarsCompact(item.stars)}</span>
                          {item.delta_1d !== null && item.delta_1d !== undefined && <DeltaBadge delta={item.delta_1d} />}
                          {item.fromLocal && (
                            <span className="rounded-full border border-[#30363d] bg-[#0d1117] px-2 py-0.5 text-[10px] text-[#8b949e]">
                              今日池
                            </span>
                          )}
                          <a
                            href={item.html_url}
                            target="_blank"
                            rel="noreferrer noopener"
                            aria-label={`${item.full_name} GitHub 外链`}
                            className="text-[#8b949e] transition-colors hover:text-[#58a6ff]"
                          >
                            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden>
                              <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm8.054-.28a.75.75 0 0 1 .476.216l.03.029a.75.75 0 0 1 .19.515v.01l-.001 4.5a.75.75 0 0 1-1.5 0V4.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06l3.22-3.22H9.75a.75.75 0 0 1 0-1.5h1.82a.75.75 0 0 1 .234.03Z" />
                            </svg>
                          </a>
                        </div>

                        <VerdictChips repo={item} className="mt-1.5" />

                        {item.takeaway ? (
                          <p className="mt-1.5 text-sm text-[#c9d1d9]">
                            <span className="mr-1.5 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 text-[10px] text-[#8b949e]">
                              取舍
                            </span>
                            {item.takeaway}
                          </p>
                        ) : (
                          <p className="mt-1.5 text-xs text-[#8b949e]">（未生成 AI 取舍）</p>
                        )}
                        {/* §9.6：候选直接给「加入对比」入口 */}
                        <div className="mt-2">
                          <CompareButton fullName={item.full_name} />
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
              {data?.note && <p className="text-xs text-[#8b949e]">{data.note}</p>}
            </div>
          )}
          {data?.cached ? <ArtifactProvenance meta={data.meta ?? null} /> : null}
        </>
      )}
    </AiCollapseRow>
  );
}
