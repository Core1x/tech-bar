// M1「今日必须看」简报 —— 确定性选择 + 可核实依据 + AI 只做解释（product-optimization-plan §7）。
// 纪律：先由确定性算法挑候选（信号=当日增量/相对增幅、新入视野、跨源同主题、源内热度、关注相关、负面信号），
// 再让 AI 为已选候选写一句"为什么今天值得看"；模型绝不从全量文本自行定榜。
// 事实（标题/度量/tags/风险）每次渲染从当前 FeedItem 现算——缓存只存选择结果与解释（§7.5），避免复制漂移；
// 指纹=选择身份（key/rank/增量量级桶/分组/关注态…），AI 推荐语被要求不含具体数字 → 日内小漂移不误判过期。
import fs from "node:fs/promises";
import path from "node:path";
import { createDeepSeekProvider } from "@/core/ai/provider";
import { resolveAiConfig } from "@/core/config/ai-config";
import { readLatest, readHistory, listGithubHistoryDates, BRIEFING_DIR } from "@/core/store/file";
import { coarseBucket, fingerprintOf, freshnessOf, type ArtifactFreshness, type ArtifactMeta } from "@/core/domain/artifact";
import { localDateStr } from "@/core/domain/calendar";
import { readPreferences, type InterestPreferences } from "@/core/config/preferences";
import type { FeedItem } from "@/core/domain/types";
import { itemHrefFor } from "./profile";
import { buildFeed, watchedKeySet, type FeedSectionResult } from "./feed";

// ---------- 视图类型（服务端 → 客户端序列化传递） ----------

export interface BriefingRisk {
  label: string;
  tone: "red" | "amber";
}

export interface BriefingItemView {
  key: string;
  source: string;
  sourceId: string;
  title: string;
  /** 打开=原文外链 */
  url: string;
  /** 打开=站内详情（经 profile 分派；无注册详情的源回退原文） */
  detailHref: string;
  sourceLabel: string;
  metricLabel: string | null;
  secondary: string | null;
  watched: boolean;
  /** 跨源同主题组（≥2 源）：组内条数与其它源兄弟条目的站内链接 */
  groupCount: number;
  groupHref: string | null;
  /** 可核实依据（确定性生成，1-3 条） */
  evidence: string[];
  /** 风险标签（负面信号，确定性） */
  risk: BriefingRisk[];
  /** "为什么今天值得看"一句（AI 生成或模板降级） */
  reason: string;
  reasonSource: "ai" | "template";
}

export interface BriefingResponse {
  ok: true;
  date: string;
  /** 数据更新于（各源快照最晚抓取时间） */
  sourceUpdatedAt: string | null;
  /** 是否已有 AI 推荐语（缓存命中且含当前候选的 key） */
  generated: boolean;
  /** AI 推荐语缓存相对当前输入的新鲜度；未生成=null */
  freshness: ArtifactFreshness | null;
  generatedAt: string | null;
  model?: string | null;
  /** 给用户的附注（如 AI 本次未返回有效推荐语，已回落确定性理由） */
  note?: string | null;
  /** 最多 5 条，单一来源最多 3 条 */
  items: BriefingItemView[];
}

interface BriefingCacheFile {
  schemaVersion: 1;
  date: string;
  sourceUpdatedAt: string | null;
  sourceFingerprint: string;
  generatedAt: string;
  model?: string | null;
  /** ai=true 的行是模型写的推荐语；缺省/false=生成时 AI 未返回该行、落的是模板回显（不得冒充 AI） */
  items: Array<{ key: string; reason: string; evidence: string[]; ai?: boolean }>;
}

// ---------- 选择输入与打分（纯函数，单测覆盖） ----------

export interface BriefingRawItem {
  key: string;
  source: string; // "github" | 其它源 id
  sourceLabel: string;
  title: string;
  /** 源内原生排序名次（1 起）与该源今日条数 */
  rank: number;
  sourceCount: number;
  watched: boolean;
  /** 同主题跨源组条数（1=无组）与其它源标签清单 */
  groupCount: number;
  otherSourceLabels: string[];
  /** 今日首次被本站发现 */
  newToSite: boolean;
  /** GitHub 专属数值（文章源为 null，跨源不混比） */
  stars?: number | null;
  delta?: number | null;
  /** 相对增幅 delta/(stars-delta) */
  relGrowth?: number | null;
  /** 归档（由 chips 信号回填） */
  archived?: boolean;
  /** 确无许可 = true（由 chips 信号回填；未知不标） */
  noLicense?: boolean;
  /** 红/黄风险标签（来自 computeSignals chips，已剔 active） */
  redFlags: string[];
  amberFlags: string[];
  metricLabel: string | null;
  /** M5 §11.3 兴趣偏好加权（只影响简报选择，不改原始榜单；缺省全不命中=行为与无偏好一致） */
  language?: string | null;
  prefLang?: boolean;
  prefTopicHits?: string[];
  prefNegativeHits?: string[];
  /** 首页偏向：new=给新入视野额外加权；mature=给高 star 老仓额外加权 */
  prefBias?: "new" | "mature" | "neutral";
}

export interface BriefingChoice {
  item: BriefingRawItem;
  score: number;
  evidence: string[];
  risk: BriefingRisk[];
  templateReason: string;
}

export interface BriefingLimits {
  max?: number;
  maxPerSource?: number;
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * 确定性打分与证据（§7.3）：
 * GitHub：当日绝对增量（按池内最大值线性 0-34）+ 相对增幅（≤10）+ 新入视野（10）+ 跨源同主题（14）+ 关注（8）；
 * 文章源：只用源内名次（0-26）与原生热度文案（绝不跨源数值混排）；
 * 负面：归档 -40（基本出局）、红信号 -18、黄信号 -6、确无许可 -6，并挂风险标签；
 * 弱信号（score<10）不硬凑尾数；总量 ≤5、单源 ≤3。
 */
export function selectBriefingItems(raw: BriefingRawItem[], limits: BriefingLimits = {}): BriefingChoice[] {
  const max = limits.max ?? 5;
  const maxPerSource = limits.maxPerSource ?? 3;

  const maxDelta = Math.max(0, ...raw.filter((r) => r.source === "github").map((r) => r.delta ?? 0));

  const scored = raw.map<BriefingChoice>((r) => {
    const evidence: string[] = [];
    const risk: BriefingRisk[] = [];
    let score = 0;

    if (r.source === "github") {
      const delta = r.delta ?? 0;
      // 榜位地板分：趋势榜头部（即使增速一般）应稳定压过单一文章源的榜首——当日增量类事件量级更大
      score += r.sourceCount > 1 ? Math.max(0, 8 * (1 - (r.rank - 1) / r.sourceCount)) : 8;
      if (delta > 0) {
        if (maxDelta > 0) score += 34 * (delta / maxDelta);
        evidence.push(`今日新增 star +${fmtInt(delta)}（GitHub 趋势榜第 ${r.rank}）`);
      } else if (r.metricLabel) {
        evidence.push(r.metricLabel);
      }
      const rel = r.relGrowth ?? 0;
      if (rel >= 0.1) {
        score += Math.min(10, rel * 30);
        evidence.push(`相对增幅 +${Math.round(rel * 100)}%`);
      }
    } else {
      score += r.sourceCount > 1 ? 26 * (1 - (r.rank - 1) / r.sourceCount) : 26;
      evidence.push(`${r.sourceLabel} 今日热度第 ${r.rank}${r.metricLabel ? `（${r.metricLabel}）` : ""}`);
    }

    if (r.groupCount >= 2) {
      score += 14;
      const others = r.otherSourceLabels.length > 0 ? `（${r.otherSourceLabels.join("、")}）` : "";
      evidence.push(`同主题跨 ${r.groupCount} 个信息源出现${others}`);
    }
    if (r.newToSite) {
      score += 10;
      if (r.prefBias === "new") score += 8;
      evidence.push("今日首次被本站发现");
    } else if (r.prefBias === "mature" && (r.stars ?? 0) >= 10000) {
      score += 8;
    }
    // 关注是长期意图的加权与界面星标状态，不是「可核实依据」，不进证据文本
    if (r.watched) score += 8;
    // M5 兴趣偏好：命中关注主题/语言加权并出可核实证据；不感兴趣主题重罚（沉底不删除，§11.3 边界）
    if (r.prefTopicHits && r.prefTopicHits.length > 0) {
      score += Math.min(16, 10 + (r.prefTopicHits.length - 1) * 3);
      evidence.push(`匹配你的关注主题「${r.prefTopicHits[0]}」`);
    }
    if (r.prefLang && r.language) {
      score += 8;
      evidence.push(`关注语言 ${r.language}`);
    }
    if (r.prefNegativeHits && r.prefNegativeHits.length > 0) {
      score -= Math.min(45, 30 * r.prefNegativeHits.length);
    }
    if (r.archived === true) {
      score -= 40;
      risk.push({ label: "已归档", tone: "red" });
    }
    for (const f of r.redFlags) {
      if (f === "已归档") continue;
      score -= 18;
      risk.push({ label: f, tone: "red" });
    }
    for (const f of r.amberFlags) {
      if (f.includes("许可")) continue;
      score -= 6;
      risk.push({ label: f, tone: "amber" });
    }
    if (r.noLicense && !risk.some((x) => x.label.includes("许可"))) {
      score -= 6;
      risk.push({ label: "无开源许可证", tone: "amber" });
    }

    const templateReason = evidence.slice(0, 2).join("，") || r.title;
    return { item: r, score, evidence: evidence.slice(0, 3), risk, templateReason };
  });

  scored.sort((a, b) => b.score - a.score || a.item.rank - b.item.rank);

  const perSource: Record<string, number> = {};
  const out: BriefingChoice[] = [];
  for (const c of scored) {
    if (out.length >= max) break;
    if (c.score < 10) continue; // 弱信号不硬凑
    const n = perSource[c.item.source] ?? 0;
    if (n >= maxPerSource) continue;
    perSource[c.item.source] = n + 1;
    out.push(c);
  }
  return out;
}

/**
 * 选择身份指纹：候选 key/rank/增量量级/分组/关注态/归档与许可风险 + 池刷新时刻（同 /api/similar 口径：
 * 「立即更新」完成即数据已更新、简报标 stale 可重建；数字走量级桶 + 界面现算 → 日内小漂移不假过期）。
 */
function briefingFingerprint(date: string, choices: BriefingChoice[], sourceUpdatedAt: string | null, prefs: InterestPreferences): string {
  return fingerprintOf({
    date,
    pool: sourceUpdatedAt ?? "none",
    prefs,
    rows: choices.map((c) => [
      c.item.key,
      c.item.rank,
      c.item.source === "github" ? coarseBucket(c.item.delta ?? null) : null,
      c.item.groupCount,
      c.item.newToSite,
      c.item.watched,
      c.item.archived === true,
      c.item.noLicense === true,
    ]),
  });
}

// ---------- 缓存读写（原子写 tmp+rename；不批量删除，按日自然积累） ----------

function briefingFile(date: string): string {
  return path.join(BRIEFING_DIR, `${date}.json`);
}

async function readBriefingCache(date: string): Promise<BriefingCacheFile | null> {
  try {
    const obj = JSON.parse(await fs.readFile(briefingFile(date), "utf-8")) as BriefingCacheFile;
    return obj && obj.schemaVersion === 1 && Array.isArray(obj.items) ? obj : null;
  } catch {
    return null;
  }
}

async function writeBriefingCache(data: BriefingCacheFile): Promise<void> {
  const file = briefingFile(data.date);
  await fs.mkdir(BRIEFING_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
  await fs.rename(tmp, file);
}

// ---------- 输入装配（唯一有 I/O 的部分） ----------

/** 今日之前最多 10 个 GitHub 历史快照的仓库全集 ——「首次被本站发现」判定的对照集 */
async function recentSeenGithubRepos(today: string): Promise<Set<string>> {
  const seen = new Set<string>();
  const dates = (await listGithubHistoryDates()).filter((d) => d < today).slice(0, 10);
  for (const d of dates) {
    const h = await readHistory(d);
    for (const r of h?.repos ?? []) seen.add(r.full_name);
  }
  return seen;
}

interface CollectedBriefing {
  choices: BriefingChoice[];
  /** 选择 key → 今日 FeedItem（事实的唯一来源，不复制进缓存） */
  itemByKey: Map<string, FeedItem>;
  /** groupId → 组成员（视图层跨源徽标/互链用） */
  groupMap: Map<string, FeedItem[]>;
  sourceUpdatedAt: string | null;
  fingerprint: string;
}

async function collectBriefingInput(date: string, sections: FeedSectionResult[]): Promise<CollectedBriefing> {
  const [watched, latest, prefs] = await Promise.all([watchedKeySet(), readLatest(), readPreferences()]);

  // GitHub 数值事实：优先趋势榜（stars_today=当日新增），缺省新星榜（delta_1d）
  const ghFacts = new Map<string, { stars: number; delta: number | null; rel: number | null; language: string | null }>();
  if (latest) {
    const trending = latest.trending ?? [];
    if (trending.length > 0) {
      for (const t of trending) {
        const delta = Number.isFinite(t.stars_today) ? t.stars_today : null;
        const base = Math.max(t.stars - (delta ?? 0), 1);
        ghFacts.set(t.full_name, { stars: t.stars, delta, rel: delta && delta > 0 ? delta / base : null, language: t.language ?? null });
      }
    } else {
      for (const r of latest.new_stars) {
        const delta = r.delta_1d ?? null;
        const base = Math.max(r.stars - (delta ?? 0), 1);
        ghFacts.set(r.full_name, { stars: r.stars, delta, rel: delta && delta > 0 ? delta / base : null, language: r.language ?? null });
      }
    }
  }
  const seenBefore = await recentSeenGithubRepos(date);

  const groupMap = new Map<string, FeedItem[]>();
  for (const s of sections)
    for (const it of s.items)
      if (it.groupId) {
        const b = groupMap.get(it.groupId);
        if (b) b.push(it);
        else groupMap.set(it.groupId, [it]);
      }

  const itemByKey = new Map<string, FeedItem>();
  const raws: BriefingRawItem[] = [];
  for (const s of sections) {
    s.items.forEach((it, idx) => {
      itemByKey.set(it.key, it);
      const group = it.groupId ? groupMap.get(it.groupId) ?? [] : [it];
      const gh = s.id === "github" ? ghFacts.get(it.sourceId) : undefined;
      const newToSite = s.id === "github" ? !seenBefore.has(it.sourceId) : (it.discoveredAt ?? "") === date;
      const chips = it.signals?.chips ?? [];
      // 兴趣偏好命中判定（§11.3：只加权简报，不改任何源数据/榜单）
      const langLower = (gh?.language ?? "").toLowerCase();
      const tagsLower = it.tags.map((t) => t.toLowerCase());
      const prefTopicHits = prefs.topics.filter((tp) => tagsLower.some((t) => t === tp || t.includes(tp)));
      const prefNegativeHits = prefs.negativeTopics.filter((tp) => tagsLower.some((t) => t === tp || t.includes(tp)));
      const prefLang = langLower.length > 0 && prefs.languages.includes(langLower);
      raws.push({
        key: it.key,
        source: s.id,
        sourceLabel: it.sourceLabel,
        title: it.title,
        rank: idx + 1,
        sourceCount: s.items.length,
        watched: watched.has(it.key) || it.watched,
        groupCount: group.length >= 2 ? group.length : 1,
        otherSourceLabels: [...new Set(group.filter((m) => m.source !== it.source).map((m) => m.sourceLabel))],
        newToSite,
        stars: gh?.stars ?? null,
        delta: gh?.delta ?? null,
        relGrowth: gh?.rel ?? null,
        archived: chips.some((c) => c.tone === "red" && c.label.includes("归档")),
        noLicense: chips.some((c) => c.tone === "amber" && c.label.includes("许可")),
        redFlags: chips.filter((c) => c.tone === "red").map((c) => c.label),
        amberFlags: chips.filter((c) => c.tone === "amber").map((c) => c.label),
        metricLabel: it.metric?.label ?? null,
        language: gh?.language ?? null,
        prefLang,
        prefTopicHits,
        prefNegativeHits,
        prefBias: prefs.bias,
      });
    });
  }

  const times = sections.map((s) => s.fetchedAt).filter((x): x is string => !!x);
  const sourceUpdatedAt = times.length ? times.sort((a, b) => Date.parse(b) - Date.parse(a))[0] : null;
  const choices = selectBriefingItems(raws);
  return { choices, itemByKey, groupMap, sourceUpdatedAt, fingerprint: briefingFingerprint(date, choices, sourceUpdatedAt, prefs) };
}

function toView(
  c: BriefingChoice,
  feed: FeedItem,
  groupMap: Map<string, FeedItem[]>,
  reason: string,
  reasonSource: "ai" | "template",
): BriefingItemView {
  const members = feed.groupId ? groupMap.get(feed.groupId) ?? [] : [];
  const sibling = members.find((m) => m.source !== feed.source);
  return {
    key: feed.key,
    source: feed.source,
    sourceId: feed.sourceId,
    title: feed.title,
    url: feed.url,
    detailHref: itemHrefFor(feed.source, feed.sourceId) || feed.url,
    sourceLabel: feed.sourceLabel,
    metricLabel: feed.metric?.label ?? null,
    secondary: feed.secondary ?? null,
    watched: feed.watched,
    groupCount: members.length >= 2 ? members.length : 0,
    groupHref: sibling ? itemHrefFor(sibling.source, sibling.sourceId) || sibling.url : null,
    evidence: c.evidence,
    risk: c.risk,
    reason,
    reasonSource,
  };
}

function composeResponse(date: string, ctx: CollectedBriefing, cache: BriefingCacheFile | null): BriefingResponse {
  let freshness: ArtifactFreshness | null = null;
  const reasonByKey = new Map<string, string>();
  if (cache) {
    const meta: ArtifactMeta = {
      schemaVersion: 1,
      kind: "briefing",
      generatedAt: cache.generatedAt,
      sourceDate: cache.date,
      sourceUpdatedAt: cache.sourceUpdatedAt,
      sourceFingerprint: cache.sourceFingerprint,
      model: cache.model ?? null,
    };
    freshness = freshnessOf(meta, ctx.fingerprint);
    // stale 的 AI 文案仍展示但会被界面标状态（与 M0.2 其它产物一致）；损坏结构（legacy）不采用
    if (freshness !== "legacy") for (const it of cache.items) if (it.ai === true) reasonByKey.set(it.key, it.reason);
  }
  const items = ctx.choices.flatMap((c) => {
    const feed = ctx.itemByKey.get(c.item.key);
    if (!feed) return [];
    const ai = reasonByKey.get(c.item.key);
    return [toView(c, feed, ctx.groupMap, ai ?? c.templateReason, ai ? "ai" : "template")];
  });
  const generated = items.some((i) => i.reasonSource === "ai");
  return {
    ok: true,
    date,
    sourceUpdatedAt: ctx.sourceUpdatedAt,
    generated,
    freshness,
    generatedAt: cache && freshness !== "legacy" ? cache.generatedAt : null,
    model: cache && freshness !== "legacy" ? cache.model : null,
    items,
  };
}

/** 只读路径：确定性现算选择 + 若有新鲜 AI 缓存则合并推荐语（零 token、零生成；可注入已构建 sections 复用） */
export async function peekBriefing(date = localDateStr(), prebuilt?: FeedSectionResult[]): Promise<BriefingResponse> {
  const sections = prebuilt ?? (await buildFeed());
  const ctx = await collectBriefingInput(date, sections);
  const cache = await readBriefingCache(date);
  return composeResponse(date, ctx, cache);
}

// ---------- AI 润色（只为已选候选写解释，禁止定榜、禁止编造数字） ----------

function buildPolishPrompt(date: string, choices: BriefingChoice[]): string {
  const lines = choices.map(
    (c, i) =>
      `${i + 1}. key=${c.item.key}｜${c.item.sourceLabel}｜${c.item.title}｜依据：${c.evidence.join("；")}${
        c.risk.length ? `｜风险：${c.risk.map((r) => r.label).join("、")}` : ""
      }`,
  );
  return `你是技术信息聚合站的编辑。下面是「${date} 今日必须看」的已选候选与各自的可核实依据（榜单由确定性算法选定，你只负责写解释，不得增删或重排候选）。
为每一条写一句「为什么今天值得看」：简体中文、不超过 25 字、只基于该条给出的依据与风险措辞，不得引入任何未给出的事实；具体数字由界面另行展示，句子里不要出现 star/增量等数值；不同源的度量不可比，不要跨源排名。

输出纪律（重要）：恰好 ${choices.length} 行、顺序与候选一致、每行一条且不含其它文字或 Markdown。
每行首选取「key || 一句话理由」格式（key 原样复制）；若省略 key，也必须保持行数与顺序严格一致（一行一条理由）。

候选：
${lines.join("\n")}`;
}

/**
 * 解析 AI 推荐语：优先「已知 key 分隔 文本」行（分隔符容忍半角 ||、全角 ｜/｜｜、裸 |，网关实测常写全角）。
 * 若模型省略了 key（只给 N 行理由），且「无 key 行」数与未命中候选数严格相等，则按候选原序对齐填充
 * （顺序对齐仅在计数吻合时采用，宁可回落模板也不错配）。绝不 JSON.parse 模型输出。
 */
export function parsePolish(raw: string, known: Set<string>, ordered?: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const bare: string[] = [];
  let sawKeyed = false;
  for (const line of raw.split("\n")) {
    const cleaned = line.trim().replace(/^[-*•\d.)、\s]+/, "").replace(/^key=/i, "");
    if (!cleaned) continue;
    const m = cleaned.match(/^(\S+?)\s*(?:[|｜]+)\s*([^|｜].*)$/);
    if (m) {
      const key = m[1].trim().replace(/^key=/i, "");
      if (known.has(key) && !out.has(key)) {
        const reason = m[2].trim().replace(/^["“「']+|["”」']+$/g, "").replace(/[|｜]+$/, "").slice(0, 60);
        if (reason) {
          out.set(key, reason);
          sawKeyed = true;
        }
        continue;
      }
      // 分隔符左边不像 key（模型把整句当左半截）→ 当作裸理由
    }
    if (!/[|｜]$/.test(cleaned)) bare.push(cleaned.replace(/^["“「']+|["”」']+$/g, "").slice(0, 60));
  }
  // 无任何可识别 key，且给了按序候选名单 → 计数吻合才按原序对齐
  if (!sawKeyed && ordered && ordered.length > 0 && bare.length === ordered.length) {
    ordered.forEach((key, i) => {
      const reason = bare[i];
      if (reason && !out.has(key)) out.set(key, reason);
    });
  }
  return out;
}

/** 生成路径：确定性选择 → AI 写解释（失败回落模板）→ 落缓存 → 返回合并后的最新响应 */
export async function generateBriefing(date: string = localDateStr()): Promise<BriefingResponse> {
  const sections = await buildFeed();
  const ctx = await collectBriefingInput(date, sections);
  if (ctx.choices.length === 0) {
    throw Object.assign(new Error("今日暂无可推荐条目（数据为空或信号均弱），请先刷新数据或浏览完整信息流"), { status: 400 });
  }
  const provider = createDeepSeekProvider();
  if (!(await provider.hasKey())) {
    throw Object.assign(new Error("未配置 AI 接入，无法生成推荐语（候选与依据已确定性展示；可在「设置」页填写后重试）"), { status: 503 });
  }
  let reasons = new Map<string, string>();
  const orderedKeys = ctx.choices.map((c) => c.item.key);
  try {
    const raw = await provider.completeChat([{ role: "user", content: buildPolishPrompt(date, ctx.choices) }], {
      signal: AbortSignal.timeout(60_000),
      disableThinking: true,
      reasoningEffort: "low",
      maxTokens: 800,
      temperature: 0.4,
    });
    reasons = parsePolish(raw, new Set(orderedKeys), orderedKeys);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 503) throw Object.assign(new Error("未配置 AI 接入，无法生成推荐语"), { status: 503 });
    // 上游失败：回落模板理由（简报本体是确定性能力，不被 AI 阻塞）
    console.warn(`[briefing] AI 推荐语生成失败，回落模板理由：${(err as Error).message}`);
  }

  const cache: BriefingCacheFile = {
    schemaVersion: 1,
    date,
    sourceUpdatedAt: ctx.sourceUpdatedAt,
    sourceFingerprint: ctx.fingerprint,
    generatedAt: new Date().toISOString(),
    model: (await resolveAiConfig()).model,
    items: ctx.choices.map((c) => ({
      key: c.item.key,
      reason: reasons.get(c.item.key) ?? c.templateReason,
      evidence: c.evidence,
      ai: reasons.has(c.item.key),
    })),
  };
  await writeBriefingCache(cache);
  const resp = composeResponse(date, ctx, cache);
  if (reasons.size === 0) {
    resp.note = "AI 未返回有效推荐语（已回落确定性理由），可稍后重试";
  } else if (reasons.size < ctx.choices.length) {
    resp.note = `AI 返回了 ${reasons.size}/${ctx.choices.length} 条推荐语，其余用确定性理由`;
  }
  return resp;
}
