// 跨源 AI 趋势周报（Phase 5 的 C 周报部分，产品：跨源叙事；独立于现有 GitHub-only 周报 lib/weekly.ts）。
// GitHub 深度复用 lib/radar.ts computeRadar（不改它）；HN 深度读本周期 sources/hackernews/history/*.json 快照。
// 产物 data/cross-digests/weekly-{endDate}.md（带前缀避开 listCrossDigests 的日期正则，不污染列表）。
// 幂等；HN history 未满一个自然周时在 prompt 注明"仅 M 天快照"，不失败。无 key 抛 503、无数据抛 400。
// 注意：本文件在 lib 层（依赖 lib/radar 的 computeRadar），遵守「core 不 import lib」——跨源周报与 lib/weekly.ts 同层。
import fs from "node:fs/promises";
import path from "node:path";
import { CROSS_DIGESTS_DIR, atomicWrite, readHnHistory, listHnDates } from "@/core/store/file";
import { dateMinusDays, lastSunday, localDateStr } from "@/core/domain/calendar";
import { createDeepSeekProvider } from "@/core/ai/provider";
import { computeRadar, type RadarData } from "./radar";

/** 跨源周报产物路径：data/cross-digests/weekly-{endDate}.md */
function crossWeeklyPath(endDate: string): string {
  return path.join(CROSS_DIGESTS_DIR, `weekly-${endDate}.md`);
}

/** 收集本周期（周一~周日）HN 快照条目（去重 by objectID，按 points 降序取前 N） */
async function collectHnWeek(endDate: string, limit = 15) {
  const weekFrom = dateMinusDays(endDate, 6);
  const dates = (await listHnDates()).filter((d) => d > weekFrom && d <= endDate);
  const seen = new Set<string>();
  const items: { sourceId: string; sourceLabel: string; title: string; points: number; metricLabel: string; secondary: string | null }[] = [];
  for (const d of dates) {
    const h = await readHnHistory(d);
    if (!h?.items?.length) continue;
    for (const raw of h.items) {
      const it = raw as { objectID?: string; source_id?: string; title?: string; metrics?: { name: string; value: number }[] };
      const id = it.source_id ?? it.objectID ?? "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const points = it.metrics?.find((m) => m.name === "points")?.value ?? 0;
      const comments = it.metrics?.find((m) => m.name === "num_comments")?.value ?? 0;
      items.push({
        sourceId: id,
        sourceLabel: "Hacker News",
        title: it.title ?? "(untitled)",
        points,
        metricLabel: `${points} pts`,
        secondary: comments > 0 ? `${comments} 评论` : null,
      });
    }
  }
  items.sort((a, b) => b.points - a.points);
  return { dates, lines: items.slice(0, limit).map((i) => `- [${i.sourceLabel}] ${i.title}｜${i.metricLabel}${i.secondary ? `｜${i.secondary}` : ""}`).join("\n") };
}

function buildPrompt(endDate: string, radar: RadarData, hnText: string, hnDays: number): string {
  const ghTop = radar.top7
    .map((r) => `- ${r.full_name}｜+${r.delta} star｜总 ${r.stars}｜${r.language ?? "未知"}｜${r.summary || r.description || "（无描述）"}`)
    .join("\n");
  const hnNote = hnDays > 0 ? `（本周内 ${hnDays} 天快照）` : "（本周内暂无 HN 快照，以下从略）";
  const hnBlock = hnText || "（本周 HN 快照不足，本条主要基于 GitHub 数据 + 有限 HN 数据撰写）";
  return `你是技术信息聚合站的主笔。基于以下「跨源本周数据」（GitHub 趋势 star 数据 + Hacker News 各天热门），为《${endDate} 跨源周报》写一篇简体中文周报（纯 Markdown，约 500-900 字，无代码围栏包裹）。
首行：# ${endDate} 跨源周报
正文包含（标题自拟，但覆盖）：
## 一周总览
## GitHub 本周亮点
## Hacker News 本周热点
## 跨源主线
要求：
- 只引用下方给出的数字与条目；禁止编造 star 数、points、项目或背景。
- 各源数据与度量保持各自原样（star 与 points 不可比），跨源判断只做"主题/趋势串联"的编辑点评。
- 若某小节无内容（如"本周无/暂未检出"），一句话带过，不要编条目。

本周 GitHub 数据（截至 ${endDate}，覆盖 ${radar.dates.length} 天快照、${radar.repoCount} 个仓库）：
【近 7 日 star 增量 Top】
${ghTop}

本周 Hacker News 数据 ${hnNote}：
【本周 HN 热门故事】
${hnBlock}`;
}

export interface CrossWeeklyResult {
  created: boolean;
  file: string;
  content: string;
  endDate: string;
}

/** 生成（或幂等读取）某跨源周报；targetEndDate 缺省 = 上一已完成自然周的收盘周日 */
export async function generateCrossWeekly(targetEndDate?: string): Promise<CrossWeeklyResult> {
  const endDate = targetEndDate ?? lastSunday(localDateStr());
  const file = crossWeeklyPath(endDate);

  // 幂等：本周期已生成 → 直接返回
  try {
    const existing = await fs.readFile(file, "utf-8");
    return { created: false, file, content: existing, endDate };
  } catch {
    // 未生成，继续
  }

  const provider = createDeepSeekProvider();
  if (!(await provider.hasKey())) {
    throw Object.assign(new Error("未配置 AI 接入，请先到「设置」页填写"), { status: 503 });
  }

  const radar = await computeRadar(endDate);
  if (radar.dates.length === 0) {
    throw Object.assign(new Error("尚无历史快照，请先刷新趋势数据"), { status: 400 });
  }
  const { dates: hnDates, lines: hnText } = await collectHnWeek(endDate);
  const content = await provider.completeChat([{ role: "user", content: buildPrompt(endDate, radar, hnText, hnDates.length) }], {
    signal: AbortSignal.timeout(120_000),
    reasoningEffort: "low",
    maxTokens: 4000,
  });
  const final = content.trim() + "\n";
  await fs.mkdir(CROSS_DIGESTS_DIR, { recursive: true });
  await atomicWrite(file, final);
  return { created: true, file, content: final, endDate };
}
