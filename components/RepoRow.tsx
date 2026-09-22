// 榜单行：排名 / 仓库名（链详情页）/ 描述（中文摘要优先）/ 语言点+名 / star / delta / GitHub 外链
import Link from "next/link";
import type { NewStarRepo } from "@/lib/types";
import { formatStars } from "@/lib/format";
import { LangDot } from "./LangDot";
import { VerdictChips } from "./VerdictChips";

// 统一千分位格式化，供 TrackedTrend 等复用
export { formatStars };

/** delta_1d：null → 灰 "—"（无昨日对比），有值 → 红色 ↑N */
export function DeltaBadge({ delta }: { delta: number | null | undefined }) {
  if (delta === null || delta === undefined) {
    return <span className="tabular-nums text-[#8b949e]">—</span>;
  }
  // §12.2：正向增长用绿色（红色是风险语义，不混用）
  return (
    <span className="font-semibold tabular-nums text-[#3fb950]">↑{formatStars(delta)}</span>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 text-[#8b949e] transition-colors group-hover/link:text-[#58a6ff]"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M15 1.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V2.707L8.207 9a.5.5 0 1 1-.707-.707L13.793 2H10.5a.5.5 0 0 1 0-1h4.5zM2.5 2.5h5a.5.5 0 0 1 0 1h-5v10h10v-5a.5.5 0 0 1 1 0v5a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"
      />
    </svg>
  );
}

export function RepoRow({ repo }: { repo: NewStarRepo }) {
  const [owner, name] = repo.full_name.split("/");
  const desc = repo.summary || repo.description || "（无描述）";

  return (
    <div className="flex items-start gap-3 border-b border-[#21262d] px-3 py-3 transition-colors hover:bg-[#161b22]">
      {/* 排名 */}
      <span className="w-7 shrink-0 pt-0.5 text-right tabular-nums text-[#8b949e]">
        {repo.rank}
      </span>

      {/* 中部：名称 + 描述 */}
      <div className="min-w-0 flex-1">
        <Link
          href={`/repo/${owner}/${name}`}
          className="font-semibold text-[#58a6ff] hover:underline break-all"
        >
          {repo.full_name}
        </Link>
        <p className="mt-0.5 line-clamp-2 text-sm text-[#8b949e]">{desc}</p>
        {/* 判读条：新星榜仓库按构造均为近30天新建，"活跃维护"必绿=噪音，故隐藏；只留硬信号（无许可/已归档） */}
        <VerdictChips repo={repo} hideKinds={["active"]} className="mt-1" />
      </div>

      {/* 右侧：语言 / star / delta / 外链 */}
      <div className="flex shrink-0 items-center gap-3 pt-0.5 text-sm">
        {repo.language && (
          <span className="flex items-center gap-1.5 text-[#8b949e]">
            <LangDot language={repo.language} />
            {repo.language}
          </span>
        )}
        <span className="tabular-nums text-[#e6edf3]">★ {formatStars(repo.stars)}</span>
        <DeltaBadge delta={repo.delta_1d} />
        <a
          href={repo.html_url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`${repo.full_name} GitHub 外链`}
          className="group/link"
        >
          <ExternalLinkIcon />
        </a>
      </div>
    </div>
  );
}
