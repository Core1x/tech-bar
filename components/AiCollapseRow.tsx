"use client";
// 详情页 AI 区块的统一外壳：默认收起为**一行状态条**（标题 + 状态徽标），点开才渲染内容。
// 目的：打开详情页不再见到一大块占位/骨架，只给「已生成 / 未生成 / 生成中 / 失败」的简示，按需展开。
// 状态由各 AI 组件在挂载 peek 缓存后回填（peek 只读服务端缓存，不耗 token，收起状态也在跑）。
// 展开偏好按 仓库+区块 记在 localStorage（下次进同一仓库保持展开/收起习惯）；读写失败静默降级。
import { useCallback, useState, type ReactNode } from "react";

// 状态口径 = product-optimization-plan M0.2 统一七态（checking 为挂载探测的瞬时态）。
// 颜色语义（§12.2）：基于最新数据=绿；过期可重生成=蓝（不显示成错误）；历史缓存=灰；失败=红；未接入=黄。
export type AiRowStatus =
  | "checking"
  | "ready"
  | "stale"
  | "legacy"
  | "missing"
  | "generating"
  | "failed"
  | "no-key";

const STATUS_UI: Record<AiRowStatus, { label: string; cls: string; spin?: boolean }> = {
  checking: { label: "检查中…", cls: "text-[#8b949e] border-[#30363d] bg-[#21262d]", spin: true },
  ready: { label: "已生成 · 基于最新数据", cls: "text-[#3fb950] border-[#3fb950]/40 bg-[#3fb950]/10" },
  stale: { label: "数据已更新 · 可重新生成", cls: "text-[#58a6ff] border-[#58a6ff]/40 bg-[#58a6ff]/10" },
  legacy: { label: "历史缓存 · 依据时间未知", cls: "text-[#8b949e] border-[#30363d] bg-[#21262d]" },
  missing: { label: "未生成", cls: "text-[#8b949e] border-[#30363d] bg-[#21262d]" },
  generating: { label: "生成中…", cls: "text-[#58a6ff] border-[#58a6ff]/40 bg-[#58a6ff]/10", spin: true },
  failed: { label: "生成失败 · 可重试", cls: "text-[#f85149] border-[#f85149]/40 bg-[#f85149]/10" },
  "no-key": { label: "未接入 AI", cls: "text-[#d29922] border-[#d29922]/40 bg-[#d29922]/10" },
};

/**
 * 展开态 + 本地偏好持久化（供 AiInsight/SimilarProjects 自持：既渲染外壳，也据此触发「展开时自动生成」）。
 * defaultOpen=true 供「未记录偏好时默认展开」的区块使用（M1 简报按 §7.2 要求默认展开，用户收起过则尊重偏好）。
 */
export function usePersistedOpen(storageKey: string, defaultOpen = false): [boolean, () => void] {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v === null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // 隐私模式等：不影响交互，仅丢持久化
      }
      return next;
    });
  }, [storageKey]);
  return [open, toggle];
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="currentColor"
      aria-hidden
      className={`shrink-0 text-[#8b949e] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
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

export function AiCollapseRow({
  title,
  hint,
  status,
  open,
  onToggle,
  children,
}: {
  title: string;
  /** 标题右侧的轻量说明（如「自动 · 展开时生成」「点击生成 · 缓存复用」） */
  hint?: string;
  status: AiRowStatus;
  /** 受控展开（open 状态在调用方，用于「展开时才自动生成」） */
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const s = STATUS_UI[status];
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-[#1c2129]"
      >
        <Chevron open={open} />
        <span className="text-sm font-semibold text-[#e6edf3]">{title}</span>
        {hint ? (
          <span className="hidden rounded-full bg-[#21262d] px-2 py-0.5 text-[10px] text-[#8b949e] sm:inline">{hint}</span>
        ) : null}
        <span
          className={`ml-auto flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${s.cls}`}
        >
          {s.spin ? <Spinner /> : null}
          <span className="truncate">{s.label}</span>
        </span>
        <span className="w-7 shrink-0 text-right text-xs text-[#8b949e]">{open ? "收起" : "展开"}</span>
      </button>
      {open ? <div className="border-t border-[#21262d] px-4 pb-4 pt-3">{children}</div> : null}
    </div>
  );
}
