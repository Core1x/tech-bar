// 统一信息流卡片：中性渲染一条 FeedItem（源码徽标 + 标题 + 描述 + tags + 各源原生度量 + 可选 chips + 关注按钮）。
// 无 "use client"、无 hooks —— 可被服务端组件直渲，也嵌进客户端组件树；关注交互由父级 FeedBoard 传入回调。
// extraAction：父级注入的额外操作位（如 M3「加入对比」按钮，仅 GitHub 板块传入），渲染在顶行外链之后。
import Link from "next/link";
import type { ReactNode } from "react";
import type { FeedItem } from "@/lib/types";
import type { ChipTone, Verdict } from "@/lib/signals";
import { itemHrefFor } from "@/core/analysis/profile";

// 各源徽标底色（沿用 GitHub 蓝 / HN 橙）
const SOURCE_BADGE: Record<string, string> = {
  github: "bg-[#58a6ff]/15 text-[#58a6ff]",
  hackernews: "bg-[#ff6600]/15 text-[#ff6600]",
  juejin: "bg-[#1e80ff]/15 text-[#1e80ff]",
  cnblogs: "bg-[#2b7cd3]/15 text-[#2b7cd3]",
};

const TONE: Record<ChipTone, string> = {
  red: "border-[#f85149]/40 bg-[#f85149]/10 text-[#f85149]",
  amber: "border-[#d29922]/40 bg-[#d29922]/10 text-[#d29922]",
  green: "border-[#3fb950]/40 bg-[#3fb950]/10 text-[#3fb950]",
};

function SignalChips({ signals }: { signals: Verdict | null }) {
  if (!signals || signals.chips.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {signals.chips.map((c) => (
        <span
          key={c.kind}
          title={c.detail}
          className={"rounded-full border px-2 py-0.5 text-xs " + TONE[c.tone]}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

function WatchButton({
  watched,
  pending,
  onToggle,
}: {
  watched: boolean;
  pending: boolean;
  onToggle?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending || !onToggle}
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
  );
}

function ExternalIcon() {
  return (
    <svg className="h-3.5 w-3.5 text-[#8b949e] transition-colors hover:text-[#58a6ff]" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M15 1.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V2.707L8.207 9a.5.5 0 1 1-.707-.707L13.793 2H10.5a.5.5 0 0 1 0-1h4.5zM2.5 2.5h5a.5.5 0 0 1 0 1h-5v10h10v-5a.5.5 0 0 1 1 0v5a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"
      />
    </svg>
  );
}

export function FeedCard({
  item,
  onToggleWatch,
  watchPending,
  groupCount,
  groupHref,
  extraAction,
}: {
  item: FeedItem;
  onToggleWatch?: (item: FeedItem) => void;
  /** 正在切换关注的 key（禁用按钮防连点） */
  watchPending?: boolean;
  /** 跨源同主题组内条数（≥2 才有值）—— Phase 5 去重/串联 */
  groupCount?: number;
  /** 同组「其它源」兄弟条目的内部详情链接（互链用） */
  groupHref?: string;
  /** 卡片顶行尾部注入的操作（如「加入对比」） */
  extraAction?: ReactNode;
}) {
  const isGithub = item.source === "github";
  // 标题统一链内部详情页（经 profile 分派：GitHub /repo/{name}，HN /hn/{id}）；外链另以图标呈现
  const detailHref = itemHrefFor(item.source, item.sourceId) || item.url;
  const badgeClass = SOURCE_BADGE[item.source] ?? "bg-[#30363d]/40 text-[#8b949e]";

  return (
    <div className="flex items-start gap-3 border-b border-[#21262d] px-4 py-3 transition-colors hover:bg-[#161b22]">
      <WatchButton watched={item.watched} pending={!!watchPending} onToggle={onToggleWatch ? () => onToggleWatch(item) : undefined} />

      <div className="min-w-0 flex-1">
        {/* 顶行：源码徽标 + 度量/次要 + 外链 */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + badgeClass}>{item.sourceLabel}</span>
          {item.metric ? (
            <span className="font-semibold tabular-nums text-[#e6edf3]">{item.metric.label}</span>
          ) : null}
          {item.secondary ? <span className="tabular-nums text-xs text-[#8b949e]">{item.secondary}</span> : null}
          {groupCount && groupCount > 1 ? (
            <span className="rounded bg-[#e3b341]/15 px-1.5 py-0.5 text-[11px] text-[#e3b341]">
              同主题跨源 ×{groupCount}
              {groupHref ? (
                <a href={groupHref} className="ml-1 underline hover:text-[#58a6ff]" onClick={(e) => e.stopPropagation()}>
                  看另一源
                </a>
              ) : null}
            </span>
          ) : null}
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={isGithub ? "GitHub 外链" : "原文外链"}
            className="group"
          >
            <ExternalIcon />
          </a>
          {extraAction ?? null}
        </div>

        {/* 标题 */}
        <Link
          href={detailHref}
          target={isGithub ? undefined : "_blank"}
          rel={isGithub ? undefined : "noopener noreferrer"}
          className="mt-1 block break-words font-medium text-[#e6edf3] hover:text-[#58a6ff]"
        >
          {item.title}
        </Link>

        {/* 描述 */}
        {item.description ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-[#8b949e]">{item.description}</p>
        ) : null}

        {/* tags */}
        {item.tags.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {item.tags.slice(0, 6).map((t) => (
              <span key={t} className="rounded bg-[#21262d] px-1.5 py-0.5 text-xs text-[#8b949e]">
                {t}
              </span>
            ))}
          </div>
        ) : null}

        <SignalChips signals={item.signals} />
      </div>
    </div>
  );
}
