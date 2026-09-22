// M0.2 AI 产物新鲜度的共用界面件：展开内容底部的「生成于 / 数据更新于」溯源行，
// 以及 stale（数据已更新）/ legacy（历史缓存）/ 重新生成失败 三种提示条（含重新生成入口）。
// 颜色口径（product-optimization-plan §12.2）：过期 ≠ 错误——stale 用主色蓝、legacy 用中性灰、
// 只有生成失败用红；旧内容始终保留展示，不被提示条顶替。
import type { ArtifactMeta } from "@/core/domain/artifact";

/** ISO → "YYYY-MM-DD HH:mm"（本地时区）；无法解析/缺省 → "未知" */
export function fmtIsoShort(iso: string | null | undefined): string {
  if (!iso) return "未知";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 展开内容底部的溯源行（§12.1 统一时间语义："生成于"=AI 产出时刻、"数据更新于"=依据数据抓取时刻） */
export function ArtifactProvenance({ meta }: { meta: ArtifactMeta | null | undefined }) {
  if (!meta) {
    return (
      <p className="mt-3 border-t border-[#21262d] pt-2 text-[11px] text-[#8b949e]">
        历史缓存 · 依据时间未知（重新生成后可溯源）
      </p>
    );
  }
  return (
    <p className="mt-3 border-t border-[#21262d] pt-2 text-[11px] text-[#8b949e]">
      生成于 {fmtIsoShort(meta.generatedAt)} · 数据更新于 {fmtIsoShort(meta.sourceUpdatedAt)}
      {meta.model ? ` · 模型 ${meta.model}` : ""}
    </p>
  );
}

/** 重新生成入口按钮（各产物块共用样式） */
function RegenerateButton({ label = "重新生成", onClick, busy }: { label?: string; onClick: () => void; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="ml-2 shrink-0 rounded-md border border-current px-2 py-0.5 text-[11px] transition-colors hover:bg-white/5 disabled:opacity-50"
    >
      {busy ? "生成中…" : label}
    </button>
  );
}

/**
 * 新鲜度/错误提示条。kind:
 * - "stale"：数据已更新、可重新生成（蓝，非错误）；
 * - "legacy"：历史缓存、依据时间未知（灰）；
 * - "failed"：重新生成失败但保留了旧内容（红）。
 */
export function ArtifactNotice({
  kind,
  error,
  hasKey = true,
  busy,
  onRegenerate,
}: {
  kind: "stale" | "legacy" | "failed";
  error?: string;
  /** 无 AI key 时不提供重新生成入口（只说明状态） */
  hasKey?: boolean;
  busy?: boolean;
  onRegenerate?: () => void;
}) {
  if (kind === "stale") {
    return (
      <div className="mb-2.5 flex items-center justify-between gap-2 rounded-md border border-[#58a6ff]/40 bg-[#58a6ff]/10 px-3 py-2 text-xs text-[#58a6ff]">
        <span>数据已更新，以下内容仍基于旧一版数据，指标可能已变化。</span>
        {onRegenerate && hasKey ? <RegenerateButton onClick={onRegenerate} busy={busy} /> : null}
      </div>
    );
  }
  if (kind === "legacy") {
    return (
      <div className="mb-2.5 flex items-center justify-between gap-2 rounded-md border border-[#30363d] bg-[#21262d] px-3 py-2 text-xs text-[#8b949e]">
        <span>历史缓存 · 依据时间未知。重新生成可获得带来源版本的最新内容。</span>
        {onRegenerate && hasKey ? <RegenerateButton onClick={onRegenerate} busy={busy} /> : null}
      </div>
    );
  }
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2 rounded-md border border-[#f85149]/40 bg-[#f85149]/10 px-3 py-2 text-xs text-[#f85149]">
      <span>重新生成失败：{error || "未知错误"}（仍显示上一版内容）</span>
      {onRegenerate && hasKey ? <RegenerateButton label="重试" onClick={onRegenerate} busy={busy} /> : null}
    </div>
  );
}
