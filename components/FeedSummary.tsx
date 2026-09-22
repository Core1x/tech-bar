"use client";
// 首页「今日跨源值得看」AI 综述块（Phase 5 A）——可伸缩框体：默认收起只显示标题栏，点标题栏展开完整内容。
// 展开/收起用 grid-template-rows 平滑过渡，高度变化自然把下方排行榜（FeedBoard）推下/拉上，布局整齐。
// 默认不自动：挂载 GET /api/cross-digest?peek=1 只查缓存（零 token）→ 收起态徽标反映状态；展开后未命中给「生成」按钮，点按 POST 才调 AI。
// auto（设置 → 功能设置 开启自动生成跨源综述 且已配 key）：挂载未命中缓存即自动生成。
// 2026-09-11 后台化：POST 立即返回 running:true（生成转后台），本组件统一靠 GET 轮询收尾——
//   命中→展示；{running}→继续等；{error}（后台生成失败，接口带回）→红框可重试；超时无果→提示重试。
// M0.2 新鲜度：GET 带 freshness/meta——stale（数据已更新·可重新生成）与 legacy（历史缓存）继续展示旧正文，
//   顶部给提示条 + 「重新生成」；重生成期间旧正文不顶替，轮询以 meta.generatedAt 变化判定成功，
//   失败保留旧正文 + 红色 genError 条。
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ArtifactFreshness, ArtifactMeta } from "@/core/domain/artifact";
import { AiUnavailableNotice } from "./AiUnavailableNotice";
import { ArtifactNotice, ArtifactProvenance } from "./ArtifactProvenance";

type LoadState = "peeking" | "missing" | "generating" | "regen" | "ready" | "error";

/** GET /api/cross-digest 响应（peek 与轮询共用） */
interface PeekResponse {
  cached?: boolean;
  content?: string;
  freshness?: ArtifactFreshness;
  meta?: ArtifactMeta | null;
  running?: boolean;
  error?: string;
  genError?: string;
}

/** 轮询上限：超过仍未产出视为后台任务丢失（进程重启等），停止轮询给用户重试入口 */
const POLL_TIMEOUT_MS = 4 * 60_000;

const BADGE: Record<LoadState, { text: string; cls: string }> = {
  peeking: { text: "检查中", cls: "bg-[#21262d] text-[#8b949e]" },
  missing: { text: "未生成", cls: "bg-[#21262d] text-[#8b949e]" },
  generating: { text: "生成中", cls: "bg-[#e3b341]/15 text-[#e3b341]" },
  regen: { text: "重新生成中", cls: "bg-[#e3b341]/15 text-[#e3b341]" },
  ready: { text: "已生成 · 基于最新数据", cls: "bg-[#238636]/20 text-[#3fb950]" },
  error: { text: "出错", cls: "bg-[#f85149]/15 text-[#f85149]" },
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden
      className={`text-[#8b949e] transition-transform duration-300 ${open ? "rotate-180" : ""}`}
    >
      <path d="M4.47 6.22 8 9.75l3.53-3.53a.75.75 0 1 1 1.06 1.06l-4.06 4.06a.75.75 0 0 1-1.06 0L3.41 7.28a.75.75 0 1 1 1.06-1.06Z" />
    </svg>
  );
}

export function FeedSummary({ auto = false, hasKey = true }: { auto?: boolean; hasKey?: boolean }) {
  const [open, setOpen] = useState(false); // 默认收起
  const [state, setState] = useState<LoadState>("peeking");
  const [content, setContent] = useState("");
  const [freshness, setFreshness] = useState<ArtifactFreshness>("fresh");
  const [meta, setMeta] = useState<ArtifactMeta | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);
  // 防重复：auto 打开时（含 React StrictMode 开发期双跑 effect）只自动生成一次
  const autoStartedRef = useRef(false);

  /** 吸收一次成功的 GET/轮询响应（内容 + 来源版本 + 失败提示） */
  function absorb(j: PeekResponse, next: LoadState) {
    setContent(j.content ?? "");
    setFreshness(j.freshness ?? (j.meta ? "fresh" : "legacy"));
    setMeta(j.meta ?? null);
    setGenError(j.genError ?? null);
    setState(next);
  }

  // 点按「生成 / 重新生成」：POST 后台受理（立即 running:true），交给轮询收尾。
  // fromExisting=true 时保持旧正文可见（regen 态），false 时展示生成中骨架（既有首生成流程）。
  async function generate(fromExisting = false) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/cross-digest", { method: "POST" });
      const j = (await res.json()) as { ok?: boolean; running?: boolean; content?: string; error?: string };
      if (res.ok && j.content && !j.running) {
        absorb({ cached: true, content: j.content, freshness: "fresh" }, "ready");
      } else if (res.ok && (j.running || j.ok)) {
        // 后台已受理；轮询在 state 效应里跑
        if (fromExisting) setState("regen");
        else setState("generating");
      } else {
        if (fromExisting) {
          setGenError(j.error ?? `提交失败（HTTP ${res.status}）`);
        } else {
          setErrorMsg(j.error ?? `提交失败（HTTP ${res.status}）`);
          setState("error");
        }
      }
    } catch {
      if (fromExisting) setGenError("网络异常，提交失败");
      else {
        setErrorMsg("网络异常，提交失败");
        setState("error");
      }
    } finally {
      setBusy(false);
    }
  }

  // 挂载：只查缓存（不耗 token、不阻塞收起态）；后台在跑→直接进「生成中」；auto 时未命中才直接提交
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cross-digest?peek=1");
        const j = (await res.json()) as PeekResponse;
        if (cancelled) return;
        if (j.cached && j.content) {
          absorb(j, "ready");
          if (j.running) setState("regen"); // 刷新前已触发的后台重生成：旧正文 + 轮询收尾
        } else if (j.running) {
          setState("generating");
        } else if (j.error) {
          setErrorMsg(j.error);
          setState("error");
        } else if (auto && !autoStartedRef.current) {
          autoStartedRef.current = true;
          void generate(false);
        } else {
          setState("missing");
        }
      } catch {
        if (!cancelled) {
          setErrorMsg("网络异常，请稍后重试");
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载一次性探测；生成由点按/auto 触发，不重复依赖
  }, [auto]);

  // 生成中/重新生成中：轮询 GET——
  //   首生成：产物出现（cached:true）即展示；
  //   重生成（regen）：旧正文本就在缓存里，以 meta.generatedAt 变化判定"替换成功"，
  //     后台失败（genError，服务端只在产物比失败旧时透出）→ 红条保留旧正文；超时无果 → 同样给错误条。
  useEffect(() => {
    if (state !== "generating" && state !== "regen") return;
    const isRegen = state === "regen";
    const prevGeneratedAt = meta?.generatedAt;
    const startedAt = Date.now();
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/cross-digest?peek=1");
        const j = (await res.json()) as PeekResponse;
        if (isRegen) {
          if (j.cached && j.meta?.generatedAt && j.meta.generatedAt !== prevGeneratedAt) {
            absorb(j, "ready"); // 新产物落盘 → 替换展示
          } else if (j.genError && !j.running) {
            setGenError(j.genError); // 重生成失败：旧正文保留 + 红条
            setState("ready");
          } else if (!j.running && Date.now() - startedAt > POLL_TIMEOUT_MS) {
            setGenError("重新生成超时未完成（AI 服务可能异常），请重试");
            setState("ready");
          }
          // 仍在跑：继续等（旧正文照常展示）
        } else {
          if (j.cached && j.content) {
            absorb(j, "ready");
          } else if (j.error && !j.running) {
            setErrorMsg(j.error);
            setState("error");
          } else if (!j.running && Date.now() - startedAt > POLL_TIMEOUT_MS) {
            setErrorMsg("生成超时未完成（AI 服务可能异常），请重试");
            setState("error");
          }
        }
      } catch {
        // 长任务中偶发失败可忽略，继续轮询（超时上限兜底）
      }
    }, 2500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prevGeneratedAt 在任务开始时定格即可
  }, [state]);

  // 收起态徽标按新鲜度细分（与 AiCollapseRow 同一套七态口径）；生成中/失败优先
  const badge =
    state === "ready" && genError
      ? { text: "生成失败 · 可重试", cls: "bg-[#f85149]/15 text-[#f85149]" }
      : state === "ready" && freshness === "stale"
        ? { text: "数据已更新 · 可重新生成", cls: "bg-[#58a6ff]/15 text-[#58a6ff]" }
        : state === "ready" && freshness === "legacy"
          ? { text: "历史缓存 · 依据时间未知", cls: "bg-[#21262d] text-[#8b949e]" }
          : BADGE[state];

  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22]">
      {/* 标题栏：可点击切换展开/收起，始终可见 */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <span className="shrink-0 text-sm font-semibold text-[#e6edf3]">今日跨源值得看</span>
        <span className={`min-w-0 truncate rounded-full px-2 py-0.5 text-[10px] ${badge.cls}`}>{badge.text}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-[#8b949e]">
          {open ? "收起" : "展开"}
          <Chevron open={open} />
        </span>
      </button>

      {/* 内容区：grid-template-rows 平滑伸缩，高度变化自然推动下方排行 */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-[#21262d] px-4 pb-4 pt-2">
            {state === "peeking" && (
              <div className="space-y-2 py-2">
                <div className="h-3 w-3/4 animate-pulse rounded bg-[#21262d]" />
                <div className="h-3 w-full animate-pulse rounded bg-[#21262d]" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-[#21262d]" />
                <p className="pt-2 text-xs text-[#8b949e]">检查缓存…</p>
              </div>
            )}

            {state === "missing" &&
              (hasKey ? (
                <div className="py-1">
                  <p className="text-sm text-[#8b949e]">今日跨源综述尚未生成</p>
                  <button
                    onClick={() => generate(false)}
                    disabled={busy}
                    className="mt-2.5 rounded-md bg-[#238636] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#2ea043] disabled:opacity-50"
                  >
                    {busy ? "提交中…" : "生成跨源综述"}
                  </button>
                  <p className="mt-1.5 text-[11px] text-[#8b949e]">仅在你点按时消耗 token，结果会缓存复用</p>
                </div>
              ) : (
                <div className="py-1">
                  <AiUnavailableNotice what="今日跨源值得看" />
                </div>
              ))}

            {state === "generating" && (
              <div className="py-1">
                <p className="text-sm text-[#8b949e]">正在后台生成（多源汇总，通常一分钟内）…</p>
                <p className="mt-1 text-[11px] text-[#8b949e]">完成后自动刷新显示，可先浏览下方信息流</p>
              </div>
            )}

            {state === "error" && (
              <div className="rounded-md border border-[#f85149]/30 bg-[#f85149]/10 px-3 py-2 text-xs text-[#f85149]">
                {errorMsg}
                <button onClick={() => generate(false)} disabled={busy} className="ml-2 underline disabled:opacity-50">
                  重试
                </button>
              </div>
            )}

            {(state === "ready" || state === "regen") && (
              <>
                {genError ? (
                  <ArtifactNotice kind="failed" error={genError} hasKey={hasKey} busy={state === "regen"} onRegenerate={() => generate(true)} />
                ) : state === "regen" ? (
                  <p className="mb-2.5 text-xs text-[#8b949e]">正在后台重新生成…（约一分钟内，下方暂为旧内容）</p>
                ) : freshness === "stale" ? (
                  <ArtifactNotice kind="stale" hasKey={hasKey} onRegenerate={() => generate(true)} />
                ) : freshness === "legacy" ? (
                  <ArtifactNotice kind="legacy" hasKey={hasKey} onRegenerate={() => generate(true)} />
                ) : null}
                <div className="markdown-body text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                </div>
                {state !== "regen" && (freshness === "fresh" || meta) ? <ArtifactProvenance meta={meta} /> : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
