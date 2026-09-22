// 追踪池趋势：按 delta_1d 降序展示前 20（服务端组件）
import Link from "next/link";
import type { TrackedRepo } from "@/lib/types";
import { LangDot } from "./LangDot";
import { DeltaBadge, formatStars } from "./RepoRow";
import { VerdictChips } from "./VerdictChips";

export function TrackedTrend({ tracked }: { tracked: TrackedRepo[] }) {
  const sorted = [...tracked]
    .sort((a, b) => (b.delta_1d ?? -1) - (a.delta_1d ?? -1))
    .slice(0, 20);

  return (
    <div className="rounded-lg border border-[#30363d] bg-[#0d1117]">
      {sorted.map((repo, i) => {
        const [owner, name] = repo.full_name.split("/");
        const desc = repo.summary || repo.description || "（无描述）";
        return (
          <div
            key={repo.full_name}
            className="flex items-start gap-3 border-b border-[#21262d] px-3 py-3 transition-colors last:border-b-0 hover:bg-[#161b22]"
          >
            <span className="w-7 shrink-0 pt-0.5 text-right tabular-nums text-[#8b949e]">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <Link
                href={`/repo/${owner}/${name}`}
                className="font-semibold text-[#58a6ff] hover:underline break-all"
              >
                {repo.full_name}
              </Link>
              <p className="mt-0.5 line-clamp-1 text-sm text-[#8b949e]">{desc}</p>
              {/* 判读条：成熟池年龄各异，绿/黄/红都有意义——判读主力展示面 */}
              <VerdictChips repo={repo} className="mt-1" />
            </div>
            <div className="flex shrink-0 items-center gap-3 pt-0.5 text-sm">
              {repo.language && (
                <span className="flex items-center gap-1.5 text-[#8b949e]">
                  <LangDot language={repo.language} />
                  {repo.language}
                </span>
              )}
              <span className="tabular-nums text-[#e6edf3]">★ {formatStars(repo.stars)}</span>
              <DeltaBadge delta={repo.delta_1d} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
