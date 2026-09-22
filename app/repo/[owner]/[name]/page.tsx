// 项目详情页：基本信息卡 + star 趋势小图 + README 懒加载渲染
// 不在当日榜单/追踪池的仓库（如 AI 寻找结果）→ 临时从 GitHub 实时拉取信息展示
import Link from "next/link";
import { listHistoryDates, readLatest, readStarHistoryIndex, rebuildStarHistoryIndex } from "@/lib/data";
import { getRepo } from "@/lib/github";
import { readFeatures } from "@/lib/features";
import { hasDeepSeekKey } from "@/lib/deepseek";
import { runningJob } from "@/lib/jobs";
import { LangDot } from "@/components/LangDot";
import { DeltaBadge, formatStars } from "@/components/RepoRow";
import { StarTrendChart, type StarPoint } from "@/components/StarTrendChart";
import { ReadmeViewer } from "@/components/ReadmeViewer";
import { ProjectDecision } from "@/components/ProjectDecision";
import { CompareButton } from "@/components/CompareButton";
import { VerdictChips } from "@/components/VerdictChips";
import { SimilarProjects } from "@/components/SimilarProjects";

export const dynamic = "force-dynamic";

/** 拉取仓库详情：瞬时网络错误重试一次；仍失败返回 null（页面显示友好提示，不 500） */
async function fetchRepoSafely(owner: string, name: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await getRepo(owner, name);
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  return null;
}

interface Props {
  params: Promise<{ owner: string; name: string }>;
}

export default async function RepoPage({ params }: Props) {
  const { owner, name } = await params;
  const fullName = `${owner}/${name}`;
  const latest = await readLatest();

  // 功能设置：详情页 AI（项目决策解释 / 同类）是否「展开时自动生成」（需已配 AI key，否则回落到点按生成；
  // AI 批任务（洞察/周报）正在生成时也回落到点按，避免详情页 AI 与之并行抢流程）
  const [features, hasAiKey, batchRunning] = await Promise.all([readFeatures(), hasDeepSeekKey(), runningJob()]);
  const noBatch = batchRunning === null;
  const autoGen = {
    decision: Boolean(features.autoDecision) && hasAiKey && noBatch,
    similar: Boolean(features.autoSimilar) && hasAiKey && noBatch,
  };

  // 1) 优先用当日数据（新星榜或追踪池）
  let repoInfo =
    latest?.new_stars.find((r) => r.full_name === fullName) ??
    latest?.tracked.find((r) => r.full_name === fullName) ??
    null;
  // 2) 不在榜单/追踪池（如 AI 寻找结果）→ 临时从 GitHub 实时拉取，和榜单仓库一样展示
  const fetched = !repoInfo;
  if (!repoInfo) {
    const gh = await fetchRepoSafely(owner, name);
    if (gh?.data) {
      repoInfo = {
        full_name: gh.data.full_name,
        description: gh.data.description,
        language: gh.data.language,
        stars: gh.data.stargazers_count,
        created_at: gh.data.created_at?.slice(0, 10),
        topics: gh.data.topics ?? [],
        html_url: gh.data.html_url,
        delta_1d: null,
        summary: null,
        // 判读信号（实时拉取分支同样带上，信息卡判读条可用）
        pushed_at: (gh.data.pushed_at ?? "").slice(0, 10) || null,
        archived: gh.data.archived ?? false,
        license: gh.data.license?.spdx_id ?? null,
        // M3 事实区（§9.3）：实时拉取天然带 fork/issue 计数
        forks: gh.data.forks_count ?? null,
        open_issues: gh.data.open_issues_count ?? null,
      };
    }
  }

  if (!repoInfo) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-12 text-center">
        <p className="text-[#e6edf3]">该仓库不存在或暂时无法获取信息</p>
        <p className="mt-2 text-sm text-[#8b949e]">
          它可能不在今日榜单与追踪池中，且实时拉取失败（GitHub 配额不足或仓库不存在）
        </p>
        <Link href="/" className="mt-3 inline-block text-sm text-[#58a6ff] hover:underline">
          ← 返回首页
        </Link>
      </main>
    );
  }

  const htmlUrl = repoInfo.html_url ?? `https://github.com/${fullName}`;

  // 遍历历史快照提取 star 序列：优先读索引（单文件，O(1) 取仓库），
  // 索引缺失或落后于最新快照时懒重建一次（兜底）
  let index = await readStarHistoryIndex();
  const latestHistoryDate = (await listHistoryDates()).pop();
  if (!index || (latestHistoryDate && index.meta.latestDate !== latestHistoryDate)) {
    index = await rebuildStarHistoryIndex();
  }
  const series: StarPoint[] = (index.repos[fullName] ?? []).map((p) => ({ date: p.date, stars: p.stars }));

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16">
      <p className="mt-4 text-sm">
        <Link href="/" className="text-[#58a6ff] hover:underline">
          ← 返回榜单
        </Link>
      </p>

      {/* 基本信息卡（全宽；判读 chips 秒显） */}
      <section className="mt-3 rounded-lg border border-[#30363d] bg-[#161b22] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-[#e6edf3] break-all">{repoInfo.full_name}</h1>
              {fetched && (
                <span className="shrink-0 rounded-full border border-[#58a6ff]/40 bg-[#58a6ff]/10 px-2 py-0.5 text-xs text-[#58a6ff]">
                  实时拉取 · 不在今日榜单
                </span>
              )}
            </div>
            <p className="mt-2 text-[#8b949e]">
              {repoInfo.summary || repoInfo.description || "（无描述）"}
            </p>
            {/* 判读条：服务端直出、秒显；无信号（未回填/实时拉取失败）时自动隐藏 */}
            <VerdictChips repo={repoInfo} className="mt-3" />
            {repoInfo.topics && repoInfo.topics.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {repoInfo.topics.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-[#30363d] bg-[#0d1117] px-2.5 py-0.5 text-xs text-[#58a6ff]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-start">
            <a
              href={htmlUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="shrink-0 rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-[#58a6ff] transition-colors hover:border-[#58a6ff]"
            >
              查看 GitHub →
            </a>
            {/* §9.4 对比入口（详情页） */}
            <CompareButton fullName={repoInfo.full_name} />
          </div>
        </div>

        {/* M3 事实区（§9.3）：八项确定性事实。license 三态（确无=「无」/未采到=「未知」/有=SPDX） */}
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-[#21262d] pt-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-[#8b949e]">总 star</p>
            <p className="mt-0.5 font-semibold text-[#e6edf3]">★ {formatStars(repoInfo.stars)}</p>
          </div>
          <div>
            <p className="text-xs text-[#8b949e]" title="自然日增量：相对上一次每日快照的 star 差">近日新增</p>
            <p className="mt-0.5 font-semibold">
              <DeltaBadge delta={repoInfo.delta_1d} />
            </p>
          </div>
          <div>
            <p className="text-xs text-[#8b949e]">fork</p>
            <p className="mt-0.5 font-semibold text-[#e6edf3]">
              {repoInfo.forks === null || repoInfo.forks === undefined ? "—" : formatStars(repoInfo.forks)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#8b949e]">open issues</p>
            <p className="mt-0.5 font-semibold text-[#e6edf3]">
              {repoInfo.open_issues === null || repoInfo.open_issues === undefined ? "—" : formatStars(repoInfo.open_issues)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#8b949e]">语言</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[#e6edf3]">
              <LangDot language={repoInfo.language} />
              {repoInfo.language ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#8b949e]">许可证</p>
            <p className="mt-0.5 text-[#e6edf3]">
              {"license" in repoInfo
                ? repoInfo.license === null || repoInfo.license === ""
                  ? "无"
                  : repoInfo.license === "NOASSERTION"
                    ? "未声明"
                    : (repoInfo.license ?? "—")
                : "未知"}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#8b949e]">最后推送</p>
            <p className="mt-0.5 text-[#e6edf3]">{repoInfo.pushed_at ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-[#8b949e]">创建时间</p>
            <p className="mt-0.5 text-[#e6edf3]">{repoInfo.created_at ?? "—"}</p>
          </div>
        </div>
        {/* 实时拉取行的 license 键存在但可能 undefined：三态由上方分支处理；「—」= 本仓数据源未提供该计数（旧快照），非「无」 */}
        <p className="mt-2 text-[11px] text-[#8b949e]">
          口径：近日新增=相对上一次每日快照的自然日 star 增量 · 数据时间 {fetched ? "实时拉取（此刻）" : `今日快照 ${latest?.updated_at?.slice(0, 16).replace("T", " ") ?? ""}`} · “—”=该计数未采集，非“无”
        </p>
      </section>

      {/* Star 趋势 */}
      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-[#e6edf3]">Star 趋势</h2>
        <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-6">
          <StarTrendChart points={series} />
        </div>
      </section>

      {/* M3（§9.1）：判读+评测合并为统一「项目决策」——结论/事实/风险确定性直出，AI 只写四段解释；
          同类项目保留为对照选型区块。key 随仓库切换重挂载 */}
      <section className="mt-6 space-y-3">
        <ProjectDecision key={`decision-${fullName}`} repo={fullName} auto={autoGen.decision} hasKey={hasAiKey} />
        <SimilarProjects key={`similar-${fullName}`} repo={fullName} auto={autoGen.similar} hasKey={hasAiKey} />
      </section>

      {/* README（key 切换仓库时重挂载，重置加载/翻译状态） */}
      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-[#e6edf3]">README</h2>
        <ReadmeViewer key={fullName} repo={fullName} htmlUrl={htmlUrl} />
      </section>
    </main>
  );
}
