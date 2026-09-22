// AI 趋势周报生成（镜像 lib/digest.ts 的幂等与错误约定）。
// 覆盖一个自然周（周一~周日），产物存 data/radar/{收盘周日}.md。
// 目标收盘日 = 上一个已完成自然周的周日（lastSunday(今天)）；周一 09:00 触发即“上周”。
// 触发：网页按钮 POST /api/weekly 走本文件；定时任务 cli/daily.ts 自动同走本文件
// （M2 已删除 daily.mjs 的 maybeGenerateWeekly 零依赖复制；冷启动锚点见 core/config/weekly-anchor.ts）。
// 所有触发经 core/jobs 单飞锁互斥，避免网页/定时并发双份 token、互相覆盖。
import fs from "node:fs/promises";
import path from "node:path";
import { RADAR_DIR, listDigests, listRadars } from "./data";
import { computeRadar, lastSunday, type RadarData } from "./radar";
import { completeChat, hasDeepSeekKey } from "./deepseek";
import { resolveAiConfig } from "./ai-config";
import { fingerprintOf, type ArtifactMeta } from "@/core/domain/artifact";
import { readArtifactMeta, writeArtifact } from "@/core/store/artifact";

/** 本地日期 YYYY-MM-DD（周报按本地自然周对齐） */
function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const MIN_SNAPSHOTS_FOR_WEEKLY = 4;

function minusDays(s: string, days: number): string {
  return new Date(Date.parse(s + "T00:00:00Z") - days * 86_400_000).toISOString().slice(0, 10);
}

async function buildPrompt(radar: RadarData): Promise<string> {
  const endDate = radar.latestDate;

  const topLines = radar.top7
    .map((r) => {
      const pct = r.pct === null ? "" : `（${r.pct}%）`;
      return `- ${r.full_name}｜+${r.delta} star${pct}｜总 ${r.stars}｜${r.language ?? "未知"}｜${r.summary || r.description || "（无描述）"}`;
    })
    .join("\n");

  const newLines = radar.newThisWeek
    .map((r) => `- ${r.full_name}（${r.firstSeen} 首次进入视野）｜总 ${r.stars}｜${r.summary || r.description || "（无描述）"}`)
    .join("\n") || "（本周无）";

  const coolLines = radar.cooling
    .map((r) => `- ${r.full_name}｜后段 ${r.rateRecent.toFixed(1)}/天｜前段 ${r.ratePrior.toFixed(1)}/天（${r.ratio === null ? "—" : r.ratio.toFixed(2)}×）`)
    .join("\n") || "（暂未检出）";

  const langLines = radar.byLanguage
    .slice(0, 10)
    .map((l) => `- ${l.language}｜+${l.delta} star（${l.repos} 仓）`)
    .join("\n");

  const topicLines = radar.byTopic
    .slice(0, 10)
    .map((t) => `- ${t.topic}｜+${t.delta} star（${t.repos} 仓）`)
    .join("\n") || "（本周无可聚合的具体话题）";

  // 同周每日洞察：标题 + 正文开头（喂叙事细节，避免复读/串线）
  const cutoff = minusDays(endDate, 6);
  const digests = await listDigests();
  const weekDigests = digests
    .filter((d) => d.date >= cutoff && d.date <= endDate)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const weekLeads =
    weekDigests.map((d) => {
      const lead = d.content.replace(/^#.*\n/, "").replace(/\s+/g, " ").trim();
      return `- ${d.date}｜${d.title}｜${lead.slice(0, 260)}${lead.length > 260 ? "…" : ""}`;
    }).join("\n") || "（本周暂无单日洞察）";

  const prevWeekly = (await listRadars())[0];
  const prevLine = prevWeekly ? `- ${prevWeekly.date}｜${prevWeekly.title}` : "（首篇，无上期）";

  return `你是开源趋势分析师。基于下方「本周确定性数据」，为《${endDate} 趋势周报》写一篇简体中文周报（纯 Markdown，约 500-900 字，无代码围栏包裹）。
首行：# ${endDate} 趋势周报
正文包含以下小节（可加导语，标题自拟但覆盖这些要点）：
## 一周总览
## 本周新星（增量为王）
## 新入视野
## 降温观察
## 按语言
要求：
- 只引用下方给出的数字，禁止编造任何 star 数、项目或背景；数据没覆盖的维度不要强行总结。
- 语言自然、有编辑判断（哪些值得关注/警惕），但判断必须锚定给出数据。
- 若某小节无内容（如“本周无/暂未检出”），用一句话带过即可，不要编条目。

本周数据（截至 ${endDate}，覆盖 ${radar.dates.length} 天快照、${radar.repoCount} 个仓库）：

【近 7 日 star 增量 Top】
${topLines}

【本周新入视野】
${newLines}

【降温观察（后段均增 < 前段）】
${coolLines}

【按语言·近 7 日增量】
${langLines}

【本周主题热度（把带增量的仓库按"具体话题"聚成生态热度，可在"一周总览/本周新星"点出正在爆发的生态）】
${topicLines}

【同周每日洞察要点（标题 + 正文开头，供细节与跨天呼应，勿整体复读）】
${weekLeads}

【上期周报标题（跨周延续）】
${prevLine}`;
}

export async function generateWeekReview(): Promise<{ created: boolean; file: string; content: string; endDate: string }> {
  // 目标 = 上一个已完成自然周（周一~周日），收盘日为上个周日：周一运行时即“上周”。
  const endDate = lastSunday(todayLocal());
  const radar = await computeRadar(endDate);
  if (radar.dates.length === 0) {
    throw Object.assign(new Error("尚无历史快照，请先点击顶栏「刷新趋势数据」生成"), { status: 400 });
  }
  const file = path.join(RADAR_DIR, `${endDate}.md`);

  // 幂等：本周期已生成 → 直接返回，不再消耗 token
  try {
    const existing = await fs.readFile(file, "utf-8");
    return { created: false, file, content: existing, endDate };
  } catch {
    // 未生成，继续
  }

  // 目标自然周（周一~周日）内至少要有一个快照，否则无从整理
  const weekFrom = minusDays(endDate, 6);
  const weekDays = radar.dates.filter((d) => d > weekFrom && d <= endDate).length;
  if (weekDays === 0) {
    throw Object.assign(
      new Error(`目标周（${weekFrom} ~ ${endDate}）内没有历史快照，暂无数据可整理`),
      { status: 400 },
    );
  }

  if (!(await hasDeepSeekKey())) {
    throw Object.assign(new Error("未配置 AI 接入，请先到「设置」页填写"), { status: 503 });
  }

  const prompt = await buildPrompt(radar);
  const content = await completeChat([{ role: "user", content: prompt }], {
    // 同 digest：长文在本机网关可超 120s
    signal: AbortSignal.timeout(240_000),
    reasoningEffort: "low",
    maxTokens: 4000,
  });
  const final = content.trim() + "\n";
  // M4（§10.2）：产物带来源版本 sidecar；指纹=喂入的 radar 派生 prompt 文本（历史周不可变 → 存档天然成立）
  const meta: ArtifactMeta = {
    schemaVersion: 1,
    kind: "weekly",
    generatedAt: new Date().toISOString(),
    sourceDate: endDate,
    sourceUpdatedAt: `${endDate}T23:59:59`,
    sourceFingerprint: fingerprintOf({ prompt }),
    model: (await resolveAiConfig()).model,
  };
  await writeArtifact(file, final, meta);
  return { created: true, file, content: final, endDate };
}

/** 周报产物的来源元数据（无 sidecar 的旧产物 → null=legacy，页面按「历史存档 · 依据时间未知」显示） */
export async function readWeeklyMeta(endDate: string): Promise<ArtifactMeta | null> {
  return readArtifactMeta(path.join(RADAR_DIR, `${endDate}.md`));
}
