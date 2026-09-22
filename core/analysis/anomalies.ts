// M1「异常变化」区域（product-optimization-plan §7.4）——只报真正需要注意的变化，全部确定性判定：
//   ① 关注项目明显加速/降温（今日新增 vs 近 7 日日均）；② 项目变为归档；
//   ③ 许可证从明确变为缺失/发生变化；④ 数据源更新失败或明显过期（今日未成功拉取）。
// 纯函数 detectAnomalies 供单测；collectAnomalies 负责读 latest/history/watchlist 装配输入。
import { readLatest, readHistory, listGithubHistoryDates } from "@/core/store/file";
import { readWatchlist, watchlistKey } from "@/core/store/file";
import { readActiveSources } from "@/core/config/sources";
import { localDateStr } from "@/core/domain/calendar";
import type { FeedSectionResult } from "./feed";

export interface Anomaly {
  kind: "accelerate" | "cool" | "archived" | "license" | "source-stale";
  /** 关联条目（GitHub=owner/name，源=id）；用于文案与潜在跳转 */
  ref: string;
  text: string;
}

interface RepoState {
  full_name: string;
  stars: number;
  /** null=原始响应确无该字段值；undefined=快照未记录（三态口径延续） */
  archived?: boolean | null;
  /** null=确无；undefined=快照未记录（三态口径延续） */
  license?: string | null;
}

export interface AnomalyInput {
  /** 关注的 GitHub 仓库 full_name 集合 */
  watchGithub: Set<string>;
  /** 今日仓库状态（trending ∪ new_stars ∪ tracked） */
  today: Map<string, RepoState>;
  /** 今日之前最近一个快照（可缺 = 冷启动，状态类变化无从比对） */
  yesterday: Map<string, RepoState> | null;
  /** 今日新增 star（仅池内有值） */
  todayDelta: Map<string, number>;
  /** 近 7 日日均新增（≥3 个相邻日对才有值；样本不足不判定加速/降温） */
  avgDelta7: Map<string, number>;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** 加速/降温阈值：基数 ≥50/日 才有意义；今日 ≥3×日均=加速，≤1/3 日均=降温 */
export function detectAnomalies(input: AnomalyInput): Anomaly[] {
  const out: Anomaly[] = [];

  for (const [name, cur] of input.today) {
    const prev = input.yesterday?.get(name);
    if (prev && prev.archived === false && cur.archived === true) {
      out.push({ kind: "archived", ref: name, text: `${name} 已变为归档（停止维护），此前判读不再适用` });
    }
    if (prev && cur.license !== undefined) {
      const was = prev.license && prev.license !== "NOASSERTION" ? prev.license : null;
      const now = cur.license && cur.license !== "NOASSERTION" ? cur.license : null;
      if (was && !now) out.push({ kind: "license", ref: name, text: `${name} 许可证不再可查（此前 ${was}）` });
      else if (was && now && was !== now)
        out.push({ kind: "license", ref: name, text: `${name} 许可证变化：${was} → ${now}` });
    }
  }

  if (input.yesterday) {
    for (const name of input.watchGithub) {
      const avg = input.avgDelta7.get(name);
      const today = input.todayDelta.get(name);
      if (avg === undefined || avg < 50 || today === undefined) continue;
      if (today >= Math.max(avg * 3, 100)) {
        out.push({ kind: "accelerate", ref: name, text: `关注项目 ${name} 明显加速：今日 +${fmt(today)}，近 7 日日均 +${fmt(Math.round(avg))}` });
      } else if (today <= avg / 3) {
        out.push({ kind: "cool", ref: name, text: `关注项目 ${name} 明显降温：今日 +${fmt(today)}，近 7 日日均 +${fmt(Math.round(avg))}` });
      }
    }
  }
  return out;
}

/** 源更新失败/明显过期：启用源今日无板块，或板块抓取时间不是今天 */
export function detectSourceStaleness(sections: FeedSectionResult[], activeIds: string[], date: string): Anomaly[] {
  const out: Anomaly[] = [];
  const byId = new Map(sections.map((s) => [s.id, s]));
  for (const id of activeIds) {
    const s = byId.get(id);
    if (!s) {
      out.push({ kind: "source-stale", ref: id, text: `${id} 今日未成功取数（无板块），请在设置页确认数据源或手动更新` });
      continue;
    }
    if ((s.fetchedAt ?? "").slice(0, 10) !== date) {
      out.push({ kind: "source-stale", ref: id, text: `${s.sourceLabel} 数据未更新至今日（最后抓取 ${s.fetchedAt?.slice(0, 16).replace("T", " ") ?? "未知"}）` });
    }
  }
  return out;
}

async function toStateMap(repos: Array<{ full_name: string; stars: number; archived?: boolean | null; license?: string | null }>): Promise<Map<string, RepoState>> {
  const m = new Map<string, RepoState>();
  for (const r of repos) {
    if (!m.has(r.full_name)) m.set(r.full_name, { full_name: r.full_name, stars: r.stars, archived: r.archived, license: r.license });
  }
  return m;
}

/** 装配 + 检测（首页服务端调用；与简报同一次渲染只读本地文件，零网络） */
export async function collectAnomalies(
  sections: FeedSectionResult[],
  date: string = localDateStr(),
): Promise<Anomaly[]> {
  const activeIds = await readActiveSources();
  const [latest, watchlist] = await Promise.all([readLatest(), readWatchlist()]);
  const out: Anomaly[] = [];
  if (latest) {
    const todayMap = await toStateMap([
      ...(latest.trending ?? []),
      ...latest.new_stars,
      ...latest.tracked,
    ]);
    const todayDelta = new Map<string, number>();
    for (const t of latest.trending ?? []) if (typeof t.stars_today === "number") todayDelta.set(t.full_name, t.stars_today);
    for (const r of latest.new_stars) if (typeof r.delta_1d === "number") todayDelta.set(r.full_name, r.delta_1d);

    // 历史：最近 8 个早于今日的快照 → 昨日状态 + 相邻日对求日均新增
    const histDates = (await listGithubHistoryDates()).filter((d) => d < date).slice(0, 8);
    const hist: Array<{ date: string; map: Map<string, RepoState> }> = [];
    for (const d of histDates) {
      const h = await readHistory(d);
      if (h) hist.push({ date: d, map: await toStateMap(h.repos) });
    }
    hist.sort((a, b) => b.date.localeCompare(a.date)); // 新→旧
    const yesterday = hist[0]?.map ?? null;

    // 日均新增：对每个仓库累加相邻快照 star 差（hist 新→旧：map[i] - map[i+1]）
    const sums = new Map<string, { total: number; n: number }>();
    for (let i = 0; i + 1 < hist.length; i++) {
      for (const [name, cur] of hist[i].map) {
        const prev = hist[i + 1].map.get(name);
        if (!prev) continue;
        const d = cur.stars - prev.stars;
        if (d < 0) continue; // 仓库计数回撤（合并/异常）不参与均值
        const s = sums.get(name) ?? { total: 0, n: 0 };
        s.total += d;
        s.n += 1;
        sums.set(name, s);
      }
    }
    const avgDelta7 = new Map<string, number>();
    for (const [name, s] of sums) if (s.n >= 3) avgDelta7.set(name, s.total / s.n);

    const watchGithub = new Set(
      watchlist.filter((e) => watchlistKey(e.source, e.source_id) && e.source === "github").map((e) => e.source_id),
    );
    out.push(...detectAnomalies({ watchGithub, today: todayMap, yesterday, todayDelta, avgDelta7 }));
  }
  out.push(...detectSourceStaleness(sections, activeIds, date));
  return out;
}
