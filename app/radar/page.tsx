// /radar 趋势雷达：把每日快照积累成时间深度（确定性指标） + AI 趋势周报（叙事档案）
// 数据由 lib/radar.computeRadar() 直读 data/history/*.json 现算（零 AI、零新管线）；
// 周报存 data/radar/{date}.md（独立目录，避免与 digests 解析冲突）；本期缺失时显示生成按钮。
import Link from "next/link";
import type { ReactNode } from "react";
import { computeRadar, lastSunday, addDays, type RadarRow } from "@/lib/radar";
import { listRadars } from "@/lib/data";
import { runningJob } from "@/lib/jobs";
import { readFeatures } from "@/lib/features";
import { readWeeklyAnchor } from "@/lib/weekly-anchor";
import { LangDot } from "@/components/LangDot";
import { VerdictChips } from "@/components/VerdictChips";
import { formatStars } from "@/components/RepoRow";
import { WeeklyGenerateButton } from "@/components/WeeklyGenerateButton";
import { JobRunningNotice } from "@/components/JobRunningNotice";
import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { RadarTopPanel } from "@/components/RadarTopPanel";
import { DigestMarkdown } from "@/components/DigestMarkdown";
import { fmtIsoShort } from "@/components/ArtifactProvenance";
import { readWeeklyMeta } from "@/lib/weekly";

export const dynamic = "force-dynamic";

/** 本地日期 YYYY-MM-DD（自然周按本地日历对齐） */
function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 雷达通用行：左=名+摘要+判读 chips；右=调用方给的 meta 簇 */
function RadarRowLine({
  row,
  rank,
  right,
  badge,
}: {
  row: RadarRow;
  rank?: number;
  right?: ReactNode;
  badge?: string;
}) {
  const desc = row.summary || row.description || "（无描述）";
  return (
    <div className="flex items-start gap-3 border-b border-[#21262d] px-3 py-3 transition-colors last:border-b-0 hover:bg-[#161b22]">
      {rank !== undefined && (
        <span className="w-6 shrink-0 pt-0.5 text-right tabular-nums text-[#8b949e]">{rank}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/repo/${row.owner}/${row.name}`}
            className="break-all font-semibold text-[#58a6ff] hover:underline"
          >
            {row.full_name}
          </Link>
          {badge && (
            <span className="rounded-full border border-[#58a6ff]/40 bg-[#58a6ff]/10 px-2 py-0.5 text-[10px] text-[#58a6ff]">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-sm text-[#8b949e]">{desc}</p>
        <VerdictChips repo={row} className="mt-1" />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5 text-sm">{right}</div>
    </div>
  );
}

function LangLine({ row }: { row: RadarRow }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-[#8b949e]">
      <LangDot language={row.language} />
      {row.language ?? "—"}
    </span>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-baseline gap-2 text-lg font-semibold text-[#e6edf3]">
        {title}
        {hint && <span className="text-xs font-normal text-[#8b949e]">{hint}</span>}
      </h2>
      <div className="overflow-hidden rounded-lg border border-[#30363d] bg-[#0d1117]">{children}</div>
    </section>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="px-3 py-3 text-sm text-[#8b949e]">{text}</p>;
}

export default async function RadarPage() {
  const radar = await computeRadar();
  const radars = await listRadars();

  const empty = radar.dates.length === 0;
  // AI 周报按自然周收盘：本期 = 上一个已完成自然周（收盘日为上个周日）
  const targetDate = lastSunday(todayLocal());
  const latestWeekly = radars.find((r) => r.date === targetDate);
  // M4 §10.2：周报来源版本（旧产物无 sidecar → null=历史存档）
  const weeklyMeta = latestWeekly ? await readWeeklyMeta(targetDate) : null;
  const olderWeekly = radars.filter((r) => r.date !== targetDate);
  const job = await runningJob();
  const generatingWeekly = job?.kind === "weekly" && job.target === targetDate;
  // 冷启动：自动周报刚开启（此前未开），锚点周未到 → 首份等下周一，不补更早的周
  const features = await readFeatures();
  const anchor = await readWeeklyAnchor();
  const coldNotDue =
    Boolean(features.autoWeeklyReport) && anchor !== null && targetDate < addDays(anchor.monday, 6);
  // 手动生成入口只在周一（周报到期日）出现：周中不显示，避免“边进行边生成”的错觉
  const isMonday = new Date().getDay() === 1;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#21262d] py-4">
        <div>
          <h1 className="text-xl font-bold text-[#e6edf3]">趋势雷达</h1>
          <p className="mt-0.5 text-xs text-[#8b949e]">
            把每日快照积累成时间深度 · 确定性指标 + AI 周报
          </p>
        </div>
        {!empty && (
          <div className="flex items-center gap-3 text-xs text-[#8b949e]">
            <span>
              覆盖 {radar.dates.length} 天 · 更新至 {radar.latestDate} · 追踪 {radar.repoCount} 仓 · 本周首次被本站发现{" "}
              {radar.newThisWeek.length}
            </span>
            <Link
              href="/"
              className="rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-[#58a6ff] transition-colors hover:border-[#58a6ff]"
            >
              ← 今日榜单
            </Link>
          </div>
        )}
      </header>

      {empty ? (
        <div className="mt-6 rounded-lg border border-[#30363d] bg-[#161b22] p-10 text-center">
          <p className="text-[#e6edf3]">暂无历史快照</p>
          <p className="mt-2 text-sm text-[#8b949e]">
            运行{" "}
            <code className="rounded bg-[#21262d] px-1.5 py-0.5 text-[#58a6ff]">
              node dist/cli/run-source.mjs
            </code>{" "}
            积累逐日数据后，这里会显示 7 日增量等时间指标
          </p>
        </div>
      ) : (
        <>
          {/* AI 周报区：本期(上一自然周)已生成则全文展开；正在生成则提示并等自动刷新；
              冷启动未到首周则给说明；否则给生成按钮。默认为收起，点标题展开完整展示 */}
          <section className="mt-6">
            <CollapsiblePanel
              title="AI 趋势周报"
              subtitle="每周一自动整理上周（周一~周日）"
              defaultOpen={false}
              titleClassName="text-lg font-semibold"
            >
              {latestWeekly ? (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#8b949e]">
                    <span>
                      生成于 {weeklyMeta ? fmtIsoShort(weeklyMeta.generatedAt) : "未知"} · 覆盖 {addDays(targetDate, -6)} ~ {targetDate} · 模型{" "}
                      {weeklyMeta?.model ?? "—"}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 ${
                        weeklyMeta
                          ? "border-[#3fb950]/40 bg-[#3fb950]/10 text-[#3fb950]"
                          : "border-[#30363d] bg-[#21262d] text-[#8b949e]"
                      }`}
                    >
                      {weeklyMeta ? "历史周存档 · 数据不可变" : "历史存档 · 依据时间未知"}
                    </span>
                  </div>
                  <div className="markdown-body">
                    <DigestMarkdown source={latestWeekly.content} />
                  </div>
                </>
              ) : generatingWeekly ? (
                <JobRunningNotice text={`截至 ${targetDate} 的 AI 周报正在后台生成中（定时任务或另一页面触发）…完成后自动刷新`} />
              ) : coldNotDue ? (
                <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4 text-sm text-[#8b949e]">
                  自动周报自{" "}
                  <span className="font-medium text-[#e6edf3]">{anchor?.monday}</span>（周一）起统计，首份完整周将在该周结束后的下周一自动生成；此前的自然周不做回补。
                </div>
              ) : isMonday ? (
                <WeeklyGenerateButton latestDate={targetDate} />
              ) : (
                <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4 text-sm text-[#8b949e]">
                  本期（上周 周一~周日）周报尚未生成。手动生成仅在<b>周一</b>开放；可开启「设置 → 功能设置 → 自动生成 AI 周报」，每周一 09:00 自动整理上周。
                </div>
              )}
            </CollapsiblePanel>
          </section>

          {/* 确定性雷达表 */}
          <div className="mt-6 space-y-6">
            <Card title="近 7 日 star 增量 Top" hint={`截至 ${radar.latestDate} · 可切「绝对增长/相对增幅」并勾选叠加对比`}>
              <RadarTopPanel rows={radar.top7} latestDate={radar.latestDate} />
            </Card>

            <Card title="本周首次被本站发现" hint="「首见」= 首次进入本站快照，不代表仓库刚创建">
              {radar.newThisWeek.length === 0 ? (
                <EmptyLine text="本周暂无首次被本站发现的仓库" />
              ) : (
                radar.newThisWeek.map((row) => (
                  <RadarRowLine
                    key={row.full_name}
                    row={row}
                    badge={row.firstSeen ? `首见 ${row.firstSeen}` : undefined}
                    right={
                      <>
                        <LangLine row={row} />
                        <span className="tabular-nums text-[#e6edf3]">★ {formatStars(row.stars)}</span>
                      </>
                    }
                  />
                ))
              )}
            </Card>

            <Card title="增速放缓观察" hint="后段均增 < 前段均增（ratio<0.7）· 双柱示前后两段时间走势">
              {radar.cooling.length === 0 ? (
                <EmptyLine text="暂未检出明显降温的仓库" />
              ) : (
                radar.cooling.map((row) => {
                  const peak = Math.max(row.rateRecent, row.ratePrior, 0.001);
                  return (
                    <RadarRowLine
                      key={row.full_name}
                      row={row}
                      right={
                        <>
                          <span className="tabular-nums text-[#e6edf3]">★ {formatStars(row.stars)}</span>
                          {/* 前后两段趋势双柱（不只显示比值） */}
                          <span className="flex w-36 items-end justify-end gap-1.5" title={`前段 ${row.ratePrior.toFixed(1)}/天 → 后段 ${row.rateRecent.toFixed(1)}/天`}>
                            <span className="flex flex-col items-center gap-0.5">
                              <span className="w-8 rounded-sm bg-[#8b949e]" style={{ height: `${Math.max(2, (row.ratePrior / peak) * 20)}px` }} />
                              <span className="text-[9px] text-[#8b949e]">前 {row.ratePrior.toFixed(0)}</span>
                            </span>
                            <span className="flex flex-col items-center gap-0.5">
                              <span className="w-8 rounded-sm bg-[#f78166]" style={{ height: `${Math.max(2, (row.rateRecent / peak) * 20)}px` }} />
                              <span className="text-[9px] text-[#f78166]">后 {row.rateRecent.toFixed(0)}</span>
                            </span>
                          </span>
                          <span className="text-xs text-[#f78166]">
                            增速 {row.ratio === null ? "—" : (row.ratio * 100).toFixed(0)}%
                          </span>
                        </>
                      }
                    />
                  );
                })
              )}
            </Card>

            <Card title="按语言 · 近 7 日增量">
              {radar.byLanguage.length === 0 ? (
                <EmptyLine text="暂无数据" />
              ) : (
                radar.byLanguage.map((l, i) => (
                  <div
                    key={l.language}
                    className="flex items-center gap-3 border-b border-[#21262d] px-3 py-2.5 text-sm last:border-b-0"
                  >
                    <span className="w-6 text-right tabular-nums text-[#8b949e]">{i + 1}</span>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[#e6edf3]">
                      <LangDot language={l.language === "未知" ? null : l.language} />
                      {l.language}
                      <span className="text-xs text-[#8b949e]">{l.repos} 仓</span>
                    </span>
                    <span className="tabular-nums text-[#3fb950]">+{formatStars(l.delta)}</span>
                  </div>
                ))
              )}
            </Card>

            <Card title="本周主题热度" hint="带增量仓库按具体话题聚出的生态热度 · 右侧为近几周逐周增量（每格=一个 7 日窗）">
              {radar.byTopic.length === 0 ? (
                <EmptyLine text="暂无聚合数据" />
              ) : (
                radar.byTopic.map((t, i) => {
                  const weeks = radar.topicWeeks.find((w) => w.topic === t.topic)?.weeks ?? [];
                  const peak = Math.max(1, ...weeks.map((w) => Math.abs(w.delta ?? 0)));
                  return (
                    <div
                      key={t.topic}
                      className="flex items-center gap-3 border-b border-[#21262d] px-3 py-2.5 text-sm last:border-b-0"
                    >
                      <span className="w-6 text-right tabular-nums text-[#8b949e]">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-[#58a6ff]">{t.topic}</span>
                      <span className="text-xs text-[#8b949e]">{t.repos} 仓</span>
                      {/* 近几周逐周增量迷你柱（从近到远）；无数据窗显示空心占位 */}
                      {weeks.length >= 2 ? (
                        <span className="flex items-end gap-1" title={weeks.map((w) => `${w.end}:${w.delta === null ? "无数据" : (w.delta >= 0 ? "+" : "") + formatStars(w.delta)}`).join("  ")}>
                          {weeks.map((w) => (
                            <span
                              key={w.end}
                              className="w-3 rounded-sm"
                              style={{
                                height: w.delta === null ? 2 : `${Math.max(2, (Math.abs(w.delta) / peak) * 18)}px`,
                                background:
                                  w.delta === null
                                    ? "transparent"
                                    : w.delta >= 0
                                      ? "#3fb950"
                                      : "#8b949e",
                                border: w.delta === null ? "1px dashed #30363d" : "none",
                              }}
                            />
                          ))}
                        </span>
                      ) : null}
                      <span className="tabular-nums text-[#3fb950]">+{formatStars(t.delta)}</span>
                    </div>
                  );
                })
              )}
            </Card>
          </div>

          {/* 历史周报（折叠） */}
          {olderWeekly.length > 0 && (
            <section className="mt-8">
              <h3 className="mb-3 text-sm font-semibold text-[#8b949e]">往期周报</h3>
              <div className="space-y-3">
                {olderWeekly.map((d) => (
                  <details key={d.filename} className="group rounded-lg border border-[#30363d] bg-[#161b22]">
                    <summary className="flex cursor-pointer items-baseline justify-between gap-4 px-4 py-3 text-[#e6edf3] marker:text-[#8b949e]">
                      <span className="text-sm font-medium">{d.title}</span>
                      <span className="shrink-0 text-xs text-[#8b949e]">{d.date}</span>
                    </summary>
                    <div className="markdown-body border-t border-[#21262d] px-4 py-3 text-sm">
                      <DigestMarkdown source={d.content} />
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
