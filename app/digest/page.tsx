// 每日洞察列表：按日期倒序列出 data/digests/*.md，首篇全文渲染，其余折叠（展开显示完整正文）。
// M4（§10.2）：每篇显示来源版本行（生成时间/数据覆盖时间/使用的信息源/是否基于当前最新快照，
//   旧产物无 meta=「历史存档 · 依据时间未知」；当日产物按数据块指纹判 fresh/stale，stale 给重新生成）；
//   正文渲染为被点名的 GitHub 仓库补站内链接（DigestMarkdown），并在文末给「关注/加入对比」快捷行动区。
import Link from "next/link";
import { listDigests, readWatchlist, watchlistKey } from "@/lib/data";
import { localDateStr, digestFingerprintToday, readDigestMeta } from "@/lib/digest";
import { runningJob } from "@/lib/jobs";
import { fmtIsoShort } from "@/components/ArtifactProvenance";
import type { ArtifactMeta } from "@/core/domain/artifact";
import { extractRepoRefs } from "@/core/domain/repo-refs";
import { DigestMarkdown } from "@/components/DigestMarkdown";
import { RepoActionList } from "@/components/RepoActionList";
import { DigestGenerateButton } from "@/components/DigestGenerateButton";
import { DigestRegenerateButton } from "@/components/DigestRegenerateButton";
import { JobRunningNotice } from "@/components/JobRunningNotice";
import { CollapsiblePanel } from "@/components/CollapsiblePanel";

export const dynamic = "force-dynamic";

/** 去掉正文首行的一级标题（标题已显示在折叠面板 header，避免重复） */
function withoutH1(md: string): string {
  const lines = md.split("\n");
  if (lines.length && lines[0]?.trimStart().startsWith("# ")) lines.shift();
  return lines.join("\n").trimStart();
}

const DIGEST_SOURCES = "GitHub 新星 Top20 · 追踪池增量 Top10";

/** 来源版本行（服务端渲染；当日条目附 stale 重新生成入口） */
function MetaLine({
  meta,
  isToday,
  currentFingerprint,
}: {
  meta: ArtifactMeta | null;
  isToday: boolean;
  currentFingerprint: string | null;
}) {
  const status = !meta
    ? { text: "历史存档 · 依据时间未知", cls: "border-[#30363d] bg-[#21262d] text-[#8b949e]" }
    : !isToday
      ? { text: "当日存档", cls: "border-[#30363d] bg-[#21262d] text-[#8b949e]" }
      : meta.sourceFingerprint === currentFingerprint
        ? { text: "已生成 · 基于最新数据", cls: "border-[#3fb950]/40 bg-[#3fb950]/10 text-[#3fb950]" }
        : { text: "数据已更新 · 可重新生成", cls: "border-[#58a6ff]/40 bg-[#58a6ff]/10 text-[#58a6ff]" };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-[#8b949e]">
      <span>
        生成于 {meta ? fmtIsoShort(meta.generatedAt) : "未知"} · 数据覆盖 {meta ? fmtIsoShort(meta.sourceUpdatedAt) : "未知"} · 信息源 {DIGEST_SOURCES}
      </span>
      <span className={`rounded-full border px-2 py-0.5 ${status.cls}`}>{status.text}</span>
      {isToday && meta && meta.sourceFingerprint !== currentFingerprint ? <DigestRegenerateButton /> : null}
    </div>
  );
}

export default async function DigestPage() {
  const digests = await listDigests();
  const [first, ...rest] = digests;
  const today = localDateStr();
  const hasToday = digests.some((d) => d.date === today);
  const job = await runningJob();
  const generatingToday = job?.kind === "digest" && job.target === today;

  // 来源版本（服务端逐篇读 sidecar；仅当日条目值得重算当前指纹做 fresh/stale 对比）
  const metas = new Map<string, ArtifactMeta | null>();
  for (const d of digests.slice(0, 6)) metas.set(d.date, await readDigestMeta(d.date));
  const currentFingerprint = hasToday ? await digestFingerprintToday() : null;
  // 行动区：正文点名仓库 + 当前关注态
  const watchedKeys = new Set((await readWatchlist()).map((e) => watchlistKey(e.source, e.source_id)));
  const actionsOf = (content: string) =>
    extractRepoRefs(content).map((fullName) => ({ fullName, watched: watchedKeys.has(`github:${fullName}`) }));

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-16">
      <header className="flex items-center justify-between border-b border-[#21262d] py-4">
        <div>
          <h1 className="text-xl font-bold text-[#e6edf3]">每日洞察</h1>
          <p className="mt-0.5 text-xs text-[#8b949e]">
            每天自动生成的中文趋势分析
          </p>
        </div>
        <Link
          href="/"
          className="rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-[#58a6ff] transition-colors hover:border-[#58a6ff]"
        >
          ← 今日榜单
        </Link>
      </header>

      {/* 今日洞察缺失：已在生成则提示并等自动刷新；否则给按需补齐按钮 */}
      {!hasToday && (
        <div className="mt-6">
          {generatingToday ? (
            <JobRunningNotice text="今日洞察正在后台生成中（定时任务或另一页面触发）…完成后自动刷新" />
          ) : (
            <DigestGenerateButton />
          )}
        </div>
      )}

      {digests.length === 0 ? (
        <div className="mt-10 rounded-lg border border-[#30363d] bg-[#161b22] p-10 text-center">
          <p className="text-[#e6edf3]">暂无洞察文章</p>
          <p className="mt-2 text-sm text-[#8b949e]">
            配置{" "}
            <code className="rounded bg-[#21262d] px-1.5 py-0.5 text-[#58a6ff]">
              DEEPSEEK_API_KEY
            </code>{" "}
            后运行{" "}
            <code className="rounded bg-[#21262d] px-1.5 py-0.5 text-[#58a6ff]">
              node dist/cli/daily.mjs
            </code>{" "}
            自动生成
          </p>
        </div>
      ) : (
        <>
          {/* 首篇全文：默认为展开，点标题收起；正文去掉首行 # 标题避免与 header 重复 */}
          <article className="mt-6">
            <CollapsiblePanel
              title={first.title}
              subtitle={first.date}
              defaultOpen={true}
              titleClassName="text-lg font-semibold"
            >
              <MetaLine meta={metas.get(first.date) ?? null} isToday={first.date === today} currentFingerprint={currentFingerprint} />
              <div className="markdown-body">
                <DigestMarkdown source={withoutH1(first.content)} />
              </div>
              <RepoActionList repos={actionsOf(first.content)} />
            </CollapsiblePanel>
          </article>

          {/* 其余折叠 */}
          {rest.length > 0 && (
            <section className="mt-10">
              <h3 className="mb-3 text-sm font-semibold text-[#8b949e]">往期洞察</h3>
              <div className="space-y-3">
                {rest.map((d) => (
                  <details
                    key={d.filename}
                    className="group rounded-lg border border-[#30363d] bg-[#161b22]"
                  >
                    <summary className="flex cursor-pointer items-baseline justify-between gap-4 px-4 py-3 text-[#e6edf3] marker:text-[#8b949e]">
                      <span className="font-medium">{d.title}</span>
                      <span className="shrink-0 text-sm text-[#8b949e]">{d.date}</span>
                    </summary>
                    {/* 展开后显示完整正文（不再截断） */}
                    <div className="border-t border-[#21262d] px-4 py-3">
                      <MetaLine meta={metas.get(d.date) ?? null} isToday={d.date === today} currentFingerprint={currentFingerprint} />
                      <div className="markdown-body text-sm">
                        <DigestMarkdown source={d.content} />
                      </div>
                      <RepoActionList repos={actionsOf(d.content)} />
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
