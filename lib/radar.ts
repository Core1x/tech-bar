// 趋势雷达 · 确定性时间计算（纯服务端；零 AI、零副作用）
// 数据源：直读 data/history/{date}.json 快照（**绝不**读 star-history 索引——索引当前只积 2 天太浅）。
// 语义对齐 update-trending 的「最近 ≤ 目标日」取点：缺口日（如 08-22/23）不假定连续。
// 输出 /radar 页可渲染的统计：近7日增量 Top、本周新入、增速放缓、按语言聚合；行字段兼容 VerdictChips 的 VerdictSource。
import type { LatestData, NewStarRepo, TrackedRepo } from "./types";
import { listHistoryDates, readHistory, readLatest } from "./data";
import { specificTopics } from "./topics";

export const RADAR_WINDOW_DAYS = 7; // 近7日增量窗
export const NEW_WINDOW_DAYS = 6; // firstSeen >= latestDate-6 → “本周新入”
export const TOP_LIMIT = 15;
export const COOLING_LIMIT = 8;
export const NEW_LIST_LIMIT = 12;

export interface RadarPoint {
  date: string;
  stars: number;
  language: string | null;
  description: string | null;
  topics?: string[];
  created_at?: string;
  pushed_at?: string | null;
  archived?: boolean;
  license?: string | null;
}

export interface RepoSeries {
  full_name: string;
  points: RadarPoint[]; // 按 date 升序
  firstSeen: string;
  lastSeen: string;
}

/** 富化行：近7日 Top 与「本周新入」共用；字段兼容 VerdictSource（undefined=未知不触发 chips） */
export interface RadarRow {
  full_name: string;
  owner: string;
  name: string;
  stars: number;
  delta: number | null;
  pct: number | null;
  avgDaily: number | null;
  spanDays: number | null;
  points: number;
  /** 首次出现在我们快照里的日期（本周新入展示"首见"） */
  firstSeen?: string;
  language: string | null;
  description: string | null;
  summary?: string | null;
  topics?: string[];
  html_url?: string;
  created_at?: string;
  delta_1d?: number | null;
  pushed_at?: string | null;
  archived?: boolean;
  license?: string | null;
  /** M4 可视化：最近 ≤10 个快照点（日期+star 原值），供迷你折线/叠加对比（零新数据源） */
  spark?: { date: string; stars: number }[];
}

export interface RadarCooling extends RadarRow {
  rateRecent: number; // 后段 星/天
  ratePrior: number; // 前段 星/天
  ratio: number | null; // rateRecent / ratePrior（ratePrior>0 才有）
}

export interface RadarByLanguage {
  language: string;
  delta: number;
  repos: number;
}

/** 主题热度：把带 7 日窗的仓库按"具体话题"聚出的生态增量（如 dsh / agent-skills 生态在涨） */
export interface RadarByTopic {
  topic: string;
  delta: number;
  repos: number;
}

/** M4（§10.1）：主题热度近几周变化——weeks 按 7 日窗从近到远排列；该窗无数据=null */
export interface RadarTopicWeeks {
  topic: string;
  weeks: { end: string; delta: number | null }[];
}

export interface RadarData {
  latestDate: string;
  dates: string[];
  repoCount: number;
  top7: RadarRow[];
  newThisWeek: RadarRow[];
  cooling: RadarCooling[];
  byLanguage: RadarByLanguage[];
  byTopic: RadarByTopic[];
  /** 主题近几周变化（取 byTopic 前列；窗数取决于历史深度，不足 2 周则数组为空/单项） */
  topicWeeks: RadarTopicWeeks[];
}

// ---------- 日期纯函数（缺口容忍） ----------

const DAY_MS = 86_400_000;

function parseDate(s: string): number {
  return Date.parse(s + "T00:00:00Z");
}

function dateMinusDays(s: string, days: number): string {
  return new Date(parseDate(s) - days * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(s: string, days: number): string {
  return new Date(parseDate(s) + days * DAY_MS).toISOString().slice(0, 10);
}

function diffDays(a: string, b: string): number {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

/** 日期 s 所在自然周（周一起）的周一 */
export function mondayOf(s: string): string {
  const dow = new Date(parseDate(s)).getUTCDay(); // 0=周日 … 6=周六
  return addDays(s, -((dow + 6) % 7));
}

/** 上一个「已完成」自然周的收盘日：日期 d 之前最近的一个周日（d 为周日时返回上周日，即下周一出上周报） */
export function lastSunday(d: string): string {
  return addDays(mondayOf(d), -1);
}

/** 序列（升序）里 date <= cutoff 的最后一个点；无则 null */
function latestAtOrBefore<T extends { date: string }>(pts: T[], cutoff: string): T | null {
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i].date <= cutoff) return pts[i];
  }
  return null;
}

// ---------- 载入归一化 ----------

export interface RadarSeriesBundle {
  dates: string[];
  series: RepoSeries[];
  latest: LatestData | null;
  join: Map<string, TrackedRepo | NewStarRepo>;
}

export async function loadRadarSeries(): Promise<RadarSeriesBundle> {
  const dates = await listHistoryDates();
  const latest = await readLatest();

  const join = new Map<string, TrackedRepo | NewStarRepo>();
  if (latest) {
    for (const r of latest.tracked) if (!join.has(r.full_name)) join.set(r.full_name, r);
    for (const r of latest.new_stars) if (!join.has(r.full_name)) join.set(r.full_name, r);
  }

  const byName = new Map<string, RadarPoint[]>();
  for (const d of dates) {
    const h = await readHistory(d);
    if (!h) continue;
    for (const r of h.repos) {
      if (!r.full_name) continue;
      const p: RadarPoint = {
        date: d,
        stars: r.stars,
        language: r.language,
        description: r.description,
        topics: r.topics,
        created_at: r.created_at,
        pushed_at: r.pushed_at,
        archived: r.archived,
        license: r.license,
      };
      const arr = byName.get(r.full_name);
      if (arr) arr.push(p);
      else byName.set(r.full_name, [p]);
    }
  }

  const series: RepoSeries[] = [];
  for (const [full_name, points] of byName) {
    if (points.length === 0) continue;
    points.sort((a, b) => (a.date < b.date ? -1 : 1));
    series.push({
      full_name,
      points,
      firstSeen: points[0].date,
      lastSeen: points[points.length - 1].date,
    });
  }

  return { dates, series, latest, join };
}

// ---------- 窗口计算 ----------

export interface WindowResult {
  to: RadarPoint | null;
  from: RadarPoint | null;
  delta: number | null;
  spanDays: number | null;
  pct: number | null;
}

export function windowDelta(pts: RadarPoint[], latestDate: string, days = RADAR_WINDOW_DAYS): WindowResult {
  const to = latestAtOrBefore(pts, latestDate);
  if (!to) return { to: null, from: null, delta: null, spanDays: null, pct: null };
  const from = latestAtOrBefore(pts, dateMinusDays(latestDate, days));
  if (!from || from.date >= to.date) return { to, from: null, delta: null, spanDays: null, pct: null };
  const spanDays = diffDays(from.date, to.date);
  const delta = to.stars - from.stars;
  const pct = from.stars > 0 ? +((delta / from.stars) * 100).toFixed(1) : null;
  return { to, from, delta, spanDays, pct };
}

type Join = Map<string, TrackedRepo | NewStarRepo>;

function buildRow(
  s: RepoSeries,
  join: Join,
  w: { delta: number | null; pct: number | null; spanDays: number | null },
  end: string,
): RadarRow {
  const j = join.get(s.full_name);
  // 基准点 = 序列里 ≤ 收盘日的最后一个点：锚定某自然周时，收盘日之后（如本周一刚写入）的快照不参与展示
  const last = latestAtOrBefore(s.points, end) ?? s.points[s.points.length - 1];
  const [owner, name] = s.full_name.split("/");
  return {
    full_name: s.full_name,
    owner: owner ?? "",
    name: name ?? "",
    stars: last.stars,
    delta: w.delta,
    pct: w.pct,
    avgDaily: w.delta !== null && w.spanDays ? +((w.delta / w.spanDays).toFixed(1)) : null,
    spanDays: w.spanDays,
    points: s.points.length,
    firstSeen: s.firstSeen,
    language: j?.language ?? last.language ?? null,
    description: j?.description ?? last.description ?? null,
    summary: j?.summary ?? null,
    topics: j?.topics ?? last.topics,
    html_url: j?.html_url ?? `https://github.com/${s.full_name}`,
    created_at: j?.created_at ?? last.created_at,
    delta_1d: j?.delta_1d ?? null,
    pushed_at: j?.pushed_at ?? last.pushed_at,
    archived: j?.archived ?? last.archived,
    license: j?.license ?? last.license,
    // M4 可视化：仅保留 ≤ 收盘日 的最近 10 点（锚定周报时不含收盘日之后的点）
    spark: s.points
      .filter((p) => p.date <= end)
      .slice(-10)
      .map((p) => ({ date: p.date, stars: p.stars })),
  };
}

// ---------- 主计算 ----------

/** 计算确定性雷达。endDate 省略 = 以最新快照日为收盘（/radar 页滚动展示）；传入 = 锚定到该收盘日（如某个自然周日） */
export async function computeRadar(endDate?: string): Promise<RadarData> {
  const { dates, series, join } = await loadRadarSeries();
  const latestDate = endDate ?? dates[dates.length - 1] ?? "";
  const base: RadarData = { latestDate, dates, repoCount: series.length, top7: [], newThisWeek: [], cooling: [], byLanguage: [], byTopic: [], topicWeeks: [] };
  if (!latestDate) return base;

  const top7: RadarRow[] = [];
  const langAcc = new Map<string, { delta: number; repos: number }>();
  const topicAcc = new Map<string, { delta: number; repos: number }>();

  for (const s of series) {
    const w = windowDelta(s.points, latestDate);
    if (w.delta !== null) {
      const row = buildRow(s, join, { delta: w.delta, pct: w.pct, spanDays: w.spanDays }, latestDate);
      top7.push(row);
      const lang = row.language ?? "未知";
      const e = langAcc.get(lang) ?? { delta: 0, repos: 0 };
      e.delta += w.delta;
      e.repos += 1;
      langAcc.set(lang, e);
      // 主题热度：按"具体话题"聚合（语言/包络词不计入；同一仓可同时贡献多个话题）
      for (const t of specificTopics(row.topics ?? [])) {
        const te = topicAcc.get(t) ?? { delta: 0, repos: 0 };
        te.delta += w.delta;
        te.repos += 1;
        topicAcc.set(t, te);
      }
    }
  }
  top7.sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));
  base.top7 = top7.slice(0, TOP_LIMIT);

  base.byLanguage = [...langAcc.entries()]
    .map(([language, v]) => ({ language, delta: v.delta, repos: v.repos }))
    .sort((a, b) => b.delta - a.delta);

  base.byTopic = [...topicAcc.entries()]
    .map(([topic, v]) => ({ topic, delta: v.delta, repos: v.repos }))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, TOP_LIMIT);

  // M4（§10.1）「主题热度近几周变化」：对 byTopic 前列，回看最多 5 个 7 日窗（本窗 + 前 4 窗），
  // 每窗独立聚合各话题增量；某窗无数据 → 该点 null（迷你柱据此显示断点，不画假 0）。
  const WEEK_LOOKBACK = 5;
  const weekEnds: string[] = [];
  for (let k = 0; k < WEEK_LOOKBACK; k++) weekEnds.push(dateMinusDays(latestDate, k * RADAR_WINDOW_DAYS));
  // 预建每窗的话题→增量映射（复用 top7 同款窗口计算，成本 O(窗数 × 仓数)）
  const perWeekTopic: Array<Map<string, number>> = weekEnds.map(() => new Map());
  for (const s of series) {
    const topics = specificTopics(join.get(s.full_name)?.topics ?? s.points[s.points.length - 1]?.topics ?? []);
    if (topics.length === 0) continue;
    weekEnds.forEach((we, wi) => {
      const w = windowDelta(s.points, we, RADAR_WINDOW_DAYS);
      if (w.delta === null) return;
      for (const t of topics) {
        const m = perWeekTopic[wi];
        m.set(t, (m.get(t) ?? 0) + w.delta);
      }
    });
  }
  // 该窗是否有任何仓库参与（避免把「无数据窗」显示成 0）
  const weekHasData = perWeekTopic.map((m) => m.size > 0);
  base.topicWeeks = base.byTopic.slice(0, 8).map((t) => ({
    topic: t.topic,
    weeks: weekEnds.map((we, wi) => ({
      end: we,
      delta: weekHasData[wi] ? perWeekTopic[wi].get(t.topic) ?? 0 : null,
    })),
  }));

  // 本周新入：firstSeen 落在最近 7 天窗口内
  const newCutoff = dateMinusDays(latestDate, NEW_WINDOW_DAYS);
  base.newThisWeek = series
    .filter((s) => s.firstSeen >= newCutoff)
    .map((s) => buildRow(s, join, { delta: null, pct: null, spanDays: null }, latestDate))
    .sort((a, b) => b.stars - a.stars)
    .slice(0, NEW_LIST_LIMIT);

  // 增速放缓：后段(近7日)均增 < 前段等长紧邻均增（ratio < 0.7）
  const cooling: RadarCooling[] = [];
  for (const s of series) {
    const pts = s.points;
    if (pts.length < 4) continue;
    const to1 = latestAtOrBefore(pts, latestDate);
    const from1 = latestAtOrBefore(pts, dateMinusDays(latestDate, RADAR_WINDOW_DAYS));
    if (!to1 || !from1 || from1.date >= to1.date) continue;
    const span = diffDays(from1.date, to1.date);
    if (span <= 0) continue;
    const rateRecent = (to1.stars - from1.stars) / span;
    const priorTo = latestAtOrBefore(pts, dateMinusDays(from1.date, 1));
    if (!priorTo) continue;
    const priorFrom = latestAtOrBefore(pts, dateMinusDays(priorTo.date, span));
    if (!priorFrom || priorFrom.date >= priorTo.date) continue;
    const priorSpan = diffDays(priorFrom.date, priorTo.date);
    if (priorSpan <= 0) continue;
    const ratePrior = (priorTo.stars - priorFrom.stars) / priorSpan;
    if (!(ratePrior > 0)) continue;
    const ratio = rateRecent / ratePrior;
    if (!(ratio < 0.7)) continue;
    const row = buildRow(s, join, { delta: to1.stars - from1.stars, pct: null, spanDays: span }, latestDate);
    cooling.push({ ...row, rateRecent, ratePrior, ratio });
  }
  cooling.sort((a, b) => (a.ratio ?? Infinity) - (b.ratio ?? Infinity));
  base.cooling = cooling.slice(0, COOLING_LIMIT);

  return base;
}
