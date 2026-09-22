// GET /api/similar?repo=owner/name — 详情页「同类项目」：找与当前仓库解决同一需求的替代/对照仓库，
// 每个保留候选给一句 AI 中文取舍（对比当前仓库）。
// 候选来源：本地今日池（topic 重叠 ≥1 具体话题）+ GitHub 精选 topic 搜索（配额纪律，见下）。
// 输出纯文本行 → 白名单解析（该模型严格 JSON 不稳，勿 JSON.parse 模型输出，见 /api/find 注释）。
// 缓存：data/cache/similar/{owner}__{name}__{fp}.json（atomicWrite）
//   source:"ai"    → TTL 7 天（同类+取舍半稳定，周级刷新）
//   source:"no-ai" → TTL 6 小时（AI 失败确定性兜底，抑制对坏 key/网络的重复搜索+重试轰炸）
//   无 AI key → 只用本地候选、不搜索、不写缓存（避免加 key 后被旧本地缓存锁死）。
// M0.2（产物新鲜度）：缓存 JSON 内嵌 meta（kind=similar）；sourceFingerprint = 当前仓库指纹 +
// 候选数据所属快照时间（候选的 star/描述均来自今日池，池刷新即视为"数据已更新"）。
// 精确指纹未命中时回退同前缀最新旧版本 → 返回 stale/legacy + 旧结果（而不是报"未生成"）；
// TTL 过期同样归入 stale。重新生成成功即写新指纹文件（自然升级），旧文件保留、不批量删除。
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { readLatest, atomicWrite } from "@/lib/data";
import { getRepo, searchRepos } from "@/lib/github";
import { completeChat, hasDeepSeekKey } from "@/lib/deepseek";
import { resolveAiConfig } from "@/lib/ai-config";
import { specificTopics, topicOverlap } from "@/lib/topics";
import { similarCandidateDisqualifies } from "@/core/domain/hot-filter";
import { fingerprintOf, type ArtifactFreshness, type ArtifactMeta } from "@/core/domain/artifact";
import { findArtifactsByPrefix } from "@/core/store/artifact";
import type { GhRepo, SimilarItem, SimilarResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SIMILAR_DIR = path.join(process.cwd(), "data", "cache", "similar");
const AI_TTL_MS = 7 * 24 * 3600 * 1000; // 含 AI 取舍的成功缓存
const NO_AI_TTL_MS = 6 * 3600 * 1000; // AI 失败后的确定性兜底缓存
const MAX_SEND = 8; // 喂给 AI 的候选上限
const MAX_KEEP = 4; // 返回行数上限
const SEARCH_PER_PAGE = 8; // 每次搜索取前 N（搜索配额 10/min，与 /api/find 共享）

// ---------- 当前仓库信息（结构同 /api/verdict 的 RepoForVerdict，另带 html_url） ----------

interface RepoForCurrent {
  full_name: string;
  description: string | null;
  summary?: string | null;
  language: string | null;
  stars: number;
  delta_1d?: number | null;
  created_at?: string | null;
  topics: string[];
  html_url?: string;
  pushed_at?: string | null;
  archived?: boolean | null;
  license?: string | null;
}

async function findRepoInfo(fullName: string): Promise<RepoForCurrent | null> {
  const latest = await readLatest();
  const fromToday =
    latest?.new_stars.find((r) => r.full_name === fullName) ??
    latest?.tracked.find((r) => r.full_name === fullName);
  if (fromToday) return fromToday as unknown as RepoForCurrent;

  const [owner, name] = fullName.split("/");
  let gh = null;
  for (let attempt = 0; attempt < 2 && !gh; attempt++) {
    try {
      gh = await getRepo(owner, name);
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  if (!gh?.data) return null;
  return {
    full_name: gh.data.full_name,
    summary: null,
    description: gh.data.description,
    language: gh.data.language,
    stars: gh.data.stargazers_count,
    delta_1d: null,
    created_at: gh.data.created_at?.slice(0, 10),
    topics: gh.data.topics ?? [],
    html_url: gh.data.html_url,
    pushed_at: (gh.data.pushed_at ?? "").slice(0, 10) || null,
    archived: gh.data.archived ?? false,
    license: gh.data.license?.spdx_id ?? null,
  };
}

/**
 * 缓存指纹：identity（含 topics+language，刻意排除 stars/delta）。
 * 对本功能 topics 是查询输入——话题变了就该重查；star 日更不该让缓存日更。
 */
function fingerprint(info: RepoForCurrent): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        archived: info.archived ?? false,
        license: info.license ?? null,
        pushed_at: info.pushed_at ?? null,
        created_at: info.created_at ?? "",
        description: info.description ?? "",
        summary: info.summary ?? "",
        language: info.language ?? null,
        topics: [...(info.topics ?? [])].sort(),
      }),
    )
    .digest("hex")
    .slice(0, 12);
}

// ---------- 搜索话题挑选（具体话题判定/重叠打分已上收至 lib/topics.ts） ----------

/** 挑用于搜索的具体话题：最长优先 + 前缀家族去重（如 dsh 与 dsh-plugin 只留一个）取 ≤2 */
function pickSearchTopics(currentTopics: string[]): string[] {
  const cur = [...specificTopics(currentTopics)].sort((a, b) => b.length - a.length);
  const chosen: string[] = [];
  for (const t of cur) {
    if (chosen.some((c) => t === c || t.startsWith(c + "-") || c.startsWith(t + "-"))) continue;
    chosen.push(t);
    if (chosen.length === 2) break;
  }
  return chosen;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "your", "you", "are", "was", "using", "based",
  "into", "open", "source", "github", "simple", "fast", "modern", "easy", "tool", "tools", "app",
  "project", "library", "framework", "support", "build", "built", "make", "made",
]);

/** 无具体话题时，从 description 抽英文关键词短语（去停用词、≤4 词）；抽不出返回 null */
function deriveKeyword(description: string | null): string | null {
  const words = (description ?? "")
    .toLowerCase()
    .match(/[a-z][a-z0-9-]{2,}/g)
    ?? [];
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const w of words) {
    if (STOP_WORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    picked.push(w);
    if (picked.length === 4) break;
  }
  return picked.length > 0 ? picked.join(" ") : null;
}

// ---------- 候选收集 ----------

/** 今日池：new_stars ∪ tracked 去重（前者优先，数据更全），并补默认字段 */
async function readPool(): Promise<Array<Record<string, unknown>>> {
  const latest = await readLatest();
  if (!latest) return [];
  const seen = new Set<string>();
  const pool: Array<Record<string, unknown>> = [];
  for (const src of [latest.new_stars, latest.tracked] as const) {
    for (const r of src) {
      if (seen.has(r.full_name)) continue;
      seen.add(r.full_name);
      pool.push({
        full_name: r.full_name,
        description: r.description ?? null,
        summary: r.summary ?? null,
        language: r.language ?? null,
        stars: r.stars,
        delta_1d: r.delta_1d ?? null,
        created_at: r.created_at ?? null,
        topics: r.topics ?? [],
        html_url: r.html_url ?? `https://github.com/${r.full_name}`,
        pushed_at: r.pushed_at ?? null,
        archived: r.archived ?? false,
        license: r.license ?? null,
      });
    }
  }
  return pool;
}

function toCandidate(p: Record<string, unknown>, curTopics: string[], fromLocal: boolean): SimilarItem {
  return {
    full_name: p.full_name as string,
    description: (p.description as string | null) ?? null,
    summary: (p.summary as string | null | undefined) ?? null,
    language: (p.language as string | null) ?? null,
    stars: (p.stars as number) ?? 0,
    delta_1d: (p.delta_1d as number | null | undefined) ?? null,
    created_at: (p.created_at as string | null | undefined) ?? null,
    topics: Array.isArray(p.topics) ? (p.topics as string[]) : [],
    html_url: (p.html_url as string) ?? `https://github.com/${p.full_name}`,
    pushed_at: (p.pushed_at as string | null | undefined) ?? null,
    archived: p.archived === undefined ? undefined : Boolean(p.archived),
    license: p.license === undefined ? undefined : ((p.license as string | null) ?? null),
    overlap: topicOverlap(curTopics, Array.isArray(p.topics) ? (p.topics as string[]) : []),
    fromLocal,
    takeaway: null,
  };
}

/** 本地候选：共享 ≥1 具体话题才收 + §9.6 质量门槛（归档/无star/信息缺失出圈）；overlap↓ → stars↓ */
function pickLocals(pool: Array<Record<string, unknown>>, curTopics: string[], selfName: string): SimilarItem[] {
  return pool
    .filter((p) => p.full_name !== selfName && topicOverlap(curTopics, p.topics as string[]) >= 1)
    .map((p) => toCandidate(p, curTopics, true))
    .filter((c) => similarCandidateDisqualifies(c) === null)
    .sort((a, b) => b.overlap - a.overlap || b.stars - a.stars)
    .slice(0, MAX_SEND);
}

/** 搜索项 → 候选（保留字段三态：缺省=未知，别误触发 chips）；排除 self 与已收本地 */
function mapSearchItems(items: GhRepo[], curTopics: string[], selfName: string, known: Set<string>): SimilarItem[] {
  const out: SimilarItem[] = [];
  for (const r of items) {
    if (!r.full_name || r.full_name === selfName || known.has(r.full_name)) continue;
    const candidate: SimilarItem = {
      full_name: r.full_name,
      description: r.description ?? null,
      summary: null,
      language: r.language ?? null,
      stars: r.stargazers_count ?? 0,
      delta_1d: null,
      created_at: r.created_at?.slice(0, 10) ?? null,
      topics: r.topics ?? [],
      html_url: r.html_url ?? `https://github.com/${r.full_name}`,
      pushed_at: (r.pushed_at ?? "").slice(0, 10) || undefined,
      archived: r.archived === undefined || r.archived === null ? undefined : r.archived,
      license: r.license === undefined ? undefined : (r.license?.spdx_id ?? null),
      overlap: topicOverlap(curTopics, r.topics ?? []),
      fromLocal: false,
      takeaway: null,
    };
    if (similarCandidateDisqualifies(candidate) !== null) continue; // §9.6 质量门槛：归档/无star/信息缺失不入
    out.push(candidate);
    known.add(r.full_name);
  }
  return out;
}

/** 单次搜索（瞬时网络错误重试一次）；限流/失败返回 null */
async function searchOnce(q: string): Promise<Awaited<ReturnType<typeof searchRepos>> | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await searchRepos(q, SEARCH_PER_PAGE);
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
      else return null;
    }
  }
  return null;
}

/** 收集候选：本地 + （本地不足时才）GitHub 搜索。搜索配额纪律：无 AI key 绝不搜索（外层保证）。 */
async function gather(info: RepoForCurrent, pool: Array<Record<string, unknown>>, hasAi: boolean): Promise<{ candidates: SimilarItem[]; searchDegraded: boolean }> {
  const curTopics = info.topics ?? [];
  const locals = pickLocals(pool, curTopics, info.full_name);
  let searchDegraded = false;

  // 本地已足 MAX_SEND（AI 已有 8 个可挑）或 无 AI（取舍没意义）→ 不搜索（省共享配额）
  if (!hasAi || locals.length >= MAX_SEND) {
    return { candidates: locals.slice(0, MAX_SEND), searchDegraded };
  }

  const merged: SimilarItem[] = [...locals];
  const seen = new Set(merged.map((m) => m.full_name));
  const topicsSel = pickSearchTopics(curTopics);
  const queries = topicsSel.length > 0
    ? topicsSel.map((t) => `topic:${t}`)
    : (() => {
        const kw = deriveKeyword(info.description);
        return kw ? [kw] : [];
      })();
  for (const q of queries.slice(0, 2)) {
    const res = await searchOnce(q);
    if (!res || res.status === 403 || res.status === 429 || !res.data) {
      searchDegraded = true;
      break;
    }
    const items = mapSearchItems(res.data, curTopics, info.full_name, seen);
    merged.push(...items);
  }

  merged.sort(
    (a, b) => b.overlap - a.overlap || Number(b.fromLocal) - Number(a.fromLocal) || b.stars - a.stars,
  );
  return { candidates: merged.slice(0, MAX_SEND), searchDegraded };
}

// ---------- AI 取舍（纯文本行，白名单解析） ----------

function buildTradeoffPrompt(cur: RepoForCurrent, cands: SimilarItem[]): string {
  const curDesc = cur.summary || cur.description || "（无描述）";
  const curTopics = (cur.topics ?? []).join("、") || "无";
  const lines = cands
    .map((c, i) =>
      `${i + 1}. ${c.full_name}｜简介：${c.summary || c.description || "无"}｜语言：${c.language ?? "未知"}｜` +
      `star：${c.stars}｜创建：${c.created_at ?? "未知"}｜归档：${c.archived === undefined ? "未提供" : String(c.archived)}｜` +
      `许可：${c.license === undefined ? "未提供" : c.license === null ? "无" : c.license}｜` +
      `上次push：${c.pushed_at ?? "未提供"}｜共享具体话题数：${c.overlap}｜来源：${c.fromLocal ? "今日池" : "GitHub 搜索"}`,
    )
    .join("\n");
  return `你是开源项目选型对比助手。用户正在看某个仓库的详情页，需要一个「同类项目」区：列出解决同一类需求、可以作为替代或对照的开源仓库，并为每个给一句与当前仓库的取舍。

从下方「候选列表」中挑出最多 4 个真正与当前仓库解决同一核心需求/同一用途的仓库：
- 跑题的一律丢弃；若某候选其实就是当前仓库本身，也丢弃；
- 候选里可能混有当前仓库的同生态周边（桌面端/插件/web 壳/文档库等）：它们只有真正可作为"替代或对照"时才保留，否则丢弃；
- 宁可少而准（1 个都行），不要硬凑。
只依据候选列表里给出的数据做判断，禁止编造任何未给出的字段（star、语言、创建时间、归档/许可、共享话题数等一律以列表为准，未列出即为未提供）。

输出格式（严格纯文本，不要 JSON、不要 Markdown、不要任何标题或解释）：
逐行输出你保留的候选，每行格式：
owner/repo —— 一句中文取舍
"一句中文取舍"要对照当前仓库写出候选的差异/权衡，15~35 字。示例：
star 多很多但已归档，仅作参考
更轻量、更新更活跃，但生态与插件较少
同为 Rust 终端方案，功能更全但配置更重
定位几乎相同，是更接近的替代
若你认为没有任何候选值得保留，只输出一行：无同类

当前仓库：${cur.full_name}
- 简介：${curDesc}
- 语言：${cur.language ?? "未知"}｜star：${cur.stars}｜创建：${cur.created_at ?? "未知"}
- 话题：${curTopics}

候选列表：
${lines}`;
}

/** 白名单解析：只认候选集内 full_name 前缀的 `owner/repo —— 取舍` 行；其余（表头/散文）忽略 */
function parseTradeoff(raw: string, known: Map<string, SimilarItem>): SimilarItem[] {
  const out: SimilarItem[] = [];
  for (const line of raw.split("\n")) {
    const cleaned = line.trim().replace(/^[-*•\d.)、.\s]+/, "");
    // 分隔符吞掉连续的一串（模型可能输出单/双/中文破折号或冒号），避免残留第二个 "—" 进文案
    const m = cleaned.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\s*[——:：\-–]+\s*([\s\S]+)$/);
    if (!m) continue;
    const cand = known.get(m[1]);
    if (!cand) continue; // 不在候选集 → 丢弃（含把当前仓库当候选输出的情形）
    if (out.some((c) => c.full_name === m[1])) continue;
    const takeaway = m[2].trim().replace(/^[——:：\-–\s]+/, "").replace(/[。.]+$/, "");
    if (!takeaway) continue;
    out.push({ ...cand, takeaway });
  }
  return out.slice(0, MAX_KEEP);
}

/** AI 失败时的确定性兜底：overlap↓ → 本地优先 → stars↓ 取 MAX_KEEP */
function fallbackPick(cands: SimilarItem[]): SimilarItem[] {
  return [...cands]
    .sort(
      (a, b) => b.overlap - a.overlap || Number(b.fromLocal) - Number(a.fromLocal) || b.stars - a.stars,
    )
    .slice(0, MAX_KEEP)
    .map((c) => ({ ...c, takeaway: null }));
}

// ---------- GET ----------

function ok(body: SimilarResponse): Response {
  return Response.json(body);
}

export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get("repo") ?? "";
  if (!REPO_PATTERN.test(repo)) {
    return Response.json({ error: "repo 参数不合法，格式应为 owner/name" }, { status: 400 });
  }
  const [owner, name] = repo.split("/");
  const fullName = `${owner}/${name}`;
  // peek=1：只查缓存，未命中不搜索/不调用 AI（前端给"生成"按钮，token 可控）
  const peek = req.nextUrl.searchParams.get("peek") === "1";

  const info = await findRepoInfo(fullName);
  if (!info) {
    return Response.json(
      { error: "仓库信息获取失败（不在今日榜单，且实时拉取失败或仓库不存在）" },
      { status: 404 },
    );
  }

  const hasAi = await hasDeepSeekKey();
  const repoFp = fingerprint(info);
  const cacheFile = path.join(SIMILAR_DIR, `${owner}__${name}__${repoFp}.json`);
  // 候选（今日池）数据所属的快照时间：进入请求的数据之一，池刷新 = 输入已变
  const poolUpdatedAt = (await readLatest())?.updated_at ?? null;
  const inputFp = fingerprintOf({ repoFp, poolUpdatedAt });

  interface SimilarCacheHit {
    ts: number;
    source: "ai" | "no-ai";
    similar: SimilarItem[];
    meta?: ArtifactMeta | null;
  }
  const loadHit = async (file: string): Promise<SimilarCacheHit | null> => {
    try {
      const hit = JSON.parse(await fs.readFile(file, "utf-8")) as SimilarCacheHit;
      return hit && Array.isArray(hit.similar) && typeof hit.ts === "number" ? hit : null;
    } catch {
      return null; // 缺失/损坏
    }
  };
  const hitFreshness = (hit: SimilarCacheHit): ArtifactFreshness => {
    const ttlOk = Date.now() - hit.ts < (hit.source === "ai" ? AI_TTL_MS : NO_AI_TTL_MS);
    if (!hit.meta || typeof hit.meta.sourceFingerprint !== "string" || !hit.meta.sourceFingerprint) return "legacy";
    return ttlOk && hit.meta.sourceFingerprint === inputFp ? "fresh" : "stale";
  };

  // 1) 读缓存：优先当前指纹精确命中；未命中则回退同前缀最新旧版本（返回 stale/legacy 供界面提示重新生成）
  let hit = await loadHit(cacheFile);
  if (!hit) {
    const older = await findArtifactsByPrefix(SIMILAR_DIR, `${owner}__${name}__`, ".json");
    for (const o of older) {
      hit = await loadHit(o.file);
      if (hit) break;
    }
  }
  if (hit) {
    const freshness = hitFreshness(hit);
    const base = { cached: true, similar: hit.similar, freshness, meta: hit.meta ?? null };
    // 探测模式：有结果（含 stale/legacy/TTL 过期）一律带回旧结果 + 状态，不搜索不调用 AI
    if (peek || freshness === "fresh") {
      if (hit.source === "ai") return ok({ ...base, aiSkipped: false, note: null });
      return ok({
        ...base,
        aiSkipped: true,
        note: hasAi
          ? "候选已缓存（AI 未生成取舍，6 小时内复用）"
          : "未配置 AI 接入",
      });
    }
    // stale/legacy 且非探测 → 落下去重新生成（成功后写入当前指纹的新文件，自然升级）
  }

  // 1.5 探测模式且彻底无缓存 → 前端显示"生成"按钮，不搜索不调用 AI
  if (peek) {
    return ok({ cached: false, similar: [], aiSkipped: true, available: false, note: null });
  }

  const pool = await readPool();

  // 2) 无 key → 本地确定性候选（不搜索、不写缓存，避免加 key 后被旧本地缓存锁死）
  if (!hasAi) {
    const locals = pickLocals(pool, info.topics ?? [], fullName).slice(0, MAX_KEEP);
    return ok({
      cached: false,
      similar: locals,
      aiSkipped: true,
      note: "未配置 AI 接入，无法生成取舍（可在「设置」页填写）；以下为今日池内候选",
    });
  }

  // 3) 收集候选（本地 + 至多 2 次搜索）
  const { candidates, searchDegraded } = await gather(info, pool, true);
  if (candidates.length === 0) {
    return ok({
      cached: false,
      similar: [],
      aiSkipped: false,
      note: searchDegraded ? "GitHub 搜索配额不足且今日池无同话题候选，未找到同类" : "未找到同类候选",
    });
  }

  // 4) AI 取舍（失败/空 → 落确定性兜底；都写短 TTL 缓存，抑制对坏 key/网络的重复搜索+重试）
  let aiThrew = false;
  let aiEmpty = false;
  const meta: ArtifactMeta = {
    schemaVersion: 1,
    kind: "similar",
    generatedAt: new Date().toISOString(),
    sourceDate: new Date().toISOString().slice(0, 10),
    sourceUpdatedAt: poolUpdatedAt,
    sourceFingerprint: inputFp,
    model: (await resolveAiConfig()).model,
  };
  try {
    const raw = await completeChat([{ role: "user", content: buildTradeoffPrompt(info, candidates) }], {
      signal: AbortSignal.timeout(75_000),
      disableThinking: true, // 关思考提速（端点不认自动降级 reasoningEffort），缩短对照候选等待
      reasoningEffort: "low",
      temperature: 0.3,
    });
    const kept = parseTradeoff(raw, new Map(candidates.map((c) => [c.full_name, c])));
    if (kept.length > 0) {
      await atomicWrite(cacheFile, JSON.stringify({ ts: Date.now(), source: "ai", similar: kept, meta }));
      const few = kept.length < 3 ? `真正同类只有 ${kept.length} 个（宁缺勿凑，未用低质量仓库补齐）${searchDegraded ? "；GitHub 搜索配额不足，覆盖可能不全" : ""}` : null;
      return ok({
        cached: false,
        similar: kept,
        aiSkipped: false,
        freshness: "fresh",
        meta,
        note: few ?? (searchDegraded ? "GitHub 搜索配额不足，结果可能未覆盖池外仓库" : null),
      });
    }
    aiEmpty = true; // AI 返回了内容但没选出可保留候选（可能确无足够替代，或输出异常）
  } catch {
    aiThrew = true; // 抛错/超时
  }

  // 5) 确定性兜底
  const fb = fallbackPick(candidates);
  if (fb.length > 0) {
    await atomicWrite(cacheFile, JSON.stringify({ ts: Date.now(), source: "no-ai", similar: fb, meta }));
  }
  const note = aiThrew
    ? "AI 生成失败，已显示候选（含本地与搜索命中）"
    : aiEmpty
      ? "AI 未选出足够同类（可能确无更强替代），已按话题重叠显示候选"
      : "已显示候选";
  return ok({ cached: false, similar: fb, aiSkipped: true, note });
}
