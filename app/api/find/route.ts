// POST /api/find — AI 智能寻找项目
// 入参：{ "query": "自然语言需求", "source": "open"|"closed"|"all", "sort": "popularity"|"relevance" }
// 流程：AI 把自然语言转成「多行英文查询词」+ 内置中英同义表兜底 + 中文原文 → 多路查询**并集去重**搜索
//       → 按开源/非开源过滤 → (relevance 按命中路数/人气排序) → AI 推荐说明
// 说明（2026-09-09 实测）：不再"首个非空即停"，也保留中文原文一路（可命中中文项目）；
//       并集让 Kodi 这类「描述含 media center」的项目在搜"开源播放器"时也能被检索到。
// 响应：{ queryUsed, repos[], aiNote, total, sort }（命中缓存时 cached: true，不消耗 AI token）
// GET  /api/find — 返回最近搜索历史；无 AI Key 时降级为「原文 + 内置同义表扩展」，仍可用。
import { NextRequest } from "next/server";
import { completeChat, hasDeepSeekKey } from "@/lib/deepseek";
import { searchRepos } from "@/lib/github";
import { getFindCache, listRecentSearches, saveFindResult } from "@/lib/find-cache";
import { keywordBlocked, readSafetyKeywords } from "@/lib/safety";
import { expandChineseQuery } from "@/lib/search-synonyms";
import { explainRepoMatch, queryTermsOf } from "@/core/domain/find-explain";
import type { GhRepo } from "@/lib/types";

type SortMode = "popularity" | "relevance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 判断仓库是否开源：带有效 SPDX 许可证即视为开源 */
function isOpenSource(repo: GhRepo): boolean {
  return typeof repo.license?.spdx_id === "string" && repo.license.spdx_id.length > 0;
}

/** 单次 GitHub 搜索（瞬时网络错误重试一次）；连续失败返回 null，限流时返回 { status } */
async function searchOnce(q: string, sortBy: SortMode): Promise<Awaited<ReturnType<typeof searchRepos>> | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await searchRepos(q, 20, sortBy);
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
      else return null;
    }
  }
  return null;
}

/** 从查询串里抽出限定符（language:/topic:/stars: 等），便于在自由词搜不到时用限定符兜底 */
function extractQualifiers(q: string): string {
  return (q.match(/\b(?:language|topic|stars|created|user|org|repo|in|is|fork|archived|size):\S+/gi) ?? [])
    .join(" ");
}

/**
 * 查询生成提示词：要求输出「多行英文查询词」，每行一条候选（含常见同义/上位词）。
 * 纯文本输出（不用 JSON；实测该模型 JSON 结构化输出不稳、占预算）。
 * 关键：多行而不是单行、宽松同义而不是 topic:/language: 硬限定 —— 让 Kodi 这类「描述含 media center」能被覆盖。
 */
function buildQueryPrompt(query: string): string {
  return `把用户的需求转成 2~4 行 GitHub 仓库搜索关键词，每行一个查询词（英文为主，覆盖常见同义/上位词，例如 "media center"、"video player"），
不要用 language:/topic:/stars: 等限定符去收窄（宁可宽，让候选更多）；忠实于原始需求主题，不要臆测换主题；可保留核心中文词作其中一行以命中中文项目。
只输出每行一个查询词本身，不要 JSON、不要解释、不要编号、不要引号。
用户需求：${query}`;
}

function buildNotePrompt(query: string, repos: GhRepo[]): string {
  const list = repos
    .slice(0, 8)
    .map(
      (r, i) =>
        `${i + 1}. ${r.full_name}｜★${r.stargazers_count}｜${r.language ?? "未知语言"}｜${r.description ?? "无描述"}${
          isOpenSource(r) ? `｜许可证 ${r.license?.spdx_id}` : "｜无许可证"
        }`,
    )
    .join("\n");
  return `你是 GitHub 开源项目推荐专家。用户需求：「${query}」。
以下是搜索到的候选项目（按 star 排序）：
${list}
请用中文给出一段简短的推荐说明（100-200 字）：选出最匹配用户需求的 3-5 个项目，逐条说明「仓库名：为什么匹配 / 亮点」。只基于以上数据，不要编造 star 数或项目信息。`;
}

/**
 * 内容安全 AI 兜底判定提示词：输出「建议排除」的仓库完整名，纯文本行（不用 JSON——
 * 实测该模型 JSON 结构化输出不稳，纯文本最稳）。
 */
function buildSafetyJudgePrompt(query: string, repos: GhRepo[]): string {
  const list = repos
    .slice(0, 15)
    .map(
      (r, i) =>
        `${i + 1}. ${r.full_name}｜${r.description ?? "无描述"}｜话题：${(r.topics ?? []).join("、") || "无"}`,
    )
    .join("\n");
  return `你是 GitHub 仓库内容安全审核员。用户需求：「${query}」。以下是搜索到的候选仓库（即将推荐给用户），请逐条判断每个仓库是否属于以下任一情形：
- 色情/成人内容（NSFW、裸体、性相关工具等）
- 宣扬或美化暴力、仇恨、歧视
- 涉政治敏感（传播违禁政治内容、攻击抹黑等）
- 描述存在明显虚假夸大宣传（虚构 star 数/下载量、冒名顶替、挂羊头卖狗肉、欺骗性描述）

输出你判断为「建议排除」的仓库完整名（owner/repo），一行一个；如果全部可以保留，只输出一行：无。
只输出仓库名本身，不要解释、不要 JSON、不要列表符号。

候选仓库：
${list}`;
}

/** 解析 AI 返回的「建议排除」仓库名列表（只认输入里真实存在的 full_name） */
function parseExcludedRepos(raw: string, known: Set<string>): string[] {
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const name = line
      .trim()
      .replace(/^[-*•\d.)、.\s]+/, "")
      .replace(/[，,;；、.:。]+$/, "")
      .trim();
    if (!name || name === "无") continue;
    if (known.has(name)) out.push(name);
  }
  return out;
}

/** 内容安全 AI 兜底判定：返回应被排除的仓库 full_name 列表（失败抛错，由调用方兜底保留原结果） */
async function aiJudgeExcludes(query: string, repos: GhRepo[]): Promise<string[]> {
  const raw = await completeChat(
    [{ role: "user", content: buildSafetyJudgePrompt(query, repos) }],
    { signal: AbortSignal.timeout(30_000), reasoningEffort: "low", temperature: 0.1 },
  );
  return parseExcludedRepos(raw, new Set(repos.map((r) => r.full_name)));
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const { query, source, sort } = (body ?? {}) as { query?: unknown; source?: unknown; sort?: unknown };
  if (typeof query !== "string" || !query.trim()) {
    return Response.json({ error: "请描述你想找的项目" }, { status: 400 });
  }
  // 防御：含无效 UTF-8 替换符（U+FFFD）的查询（非 UTF-8 输入/拷贝损坏）直接拒绝，不污染缓存
  if (/�/.test(query)) {
    return Response.json({ error: "查询包含非法字符，请重新输入" }, { status: 400 });
  }
  const sourceMode = source === "closed" || source === "open" ? source : "all";
  const sortBy: SortMode = sort === "relevance" ? "relevance" : "popularity";
  const rawQuery = query.trim().slice(0, 120);

  // 内容安全关键词配置（enabled=false 时 keywords 为空 → 关键词层不生效，仅剩 AI 兜底）
  const safety = await readSafetyKeywords();

  // 0. 缓存命中：同一查询（query + 筛选 + 排序）在有效期内直接复用，避免重复消耗 AI token
  const cached = await getFindCache(rawQuery, sourceMode, sortBy);
  if (cached) {
    return Response.json({
      queryUsed: cached.queryUsed,
      sourceMode,
      sort: sortBy,
      aiNote: cached.aiNote,
      total: cached.repos.length,
      repos: cached.repos,
      cached: true,
    });
  }

  const hasAi = await hasDeepSeekKey();

  // 1. 候选查询集（**多路**，都要搜、都并集）：AI 多行英文查询 + 内置中英同义 + 中文原文（保中文项目）+ 限定符。
  //    不再"首个非空即停"——保留中文路能命中中文项目，英文/同义路能命中 Kodi 这类英文描述项目。
  let aiQueries: string[] = [];
  if (hasAi) {
    try {
      const aiText = await completeChat(
        [{ role: "user", content: buildQueryPrompt(query) }],
        { signal: AbortSignal.timeout(30_000), reasoningEffort: "low", temperature: 0.2 },
      );
      aiQueries = aiText
        .split("\n")
        .map((s) => s.trim().replace(/["'`{}]/g, "").replace(/^[-*\d.)、.\s]+/, "").trim())
        .filter(Boolean)
        .slice(0, 4);
    } catch {
      // AI 转换失败或超时 → 交给内置同义表 + 原文
    }
  }
  const synonym = expandChineseQuery(rawQuery); // 确定性兜底（命中规则才非空）
  const candidates = [
    ...aiQueries,
    ...synonym,
    rawQuery, // 中文原文（保中文项目）
    ...(aiQueries.length ? [extractQualifiers(aiQueries[0])] : []),
  ]
    .filter((q, i, arr) => !!q && arr.indexOf(q) === i) // 去重（保持首次出现序）
    .slice(0, 6); // 限 6 路，控制 GitHub Search 配额（30/min，单次 find 最多 6 次）

  // 2. 多路搜索：全部候选都搜，按 full_name 并集去重（不因某路空/无关而丢弃其它路）
  //    hits/hitQueries 为「为什么匹配」提供可核实的路径证据（M5 §11.1）
  const byName = new Map<string, GhRepo & { hits?: number; hitQueries?: string[] }>();
  let hitError = false;
  let kwBlocked = 0; // 关键词层被剔除的候选数（用于前端区分「无匹配」与「被过滤」）
  for (const q of candidates) {
    const res = await searchOnce(q, sortBy);
    if (!res) {
      hitError = true; // 网络失败（已重试）
      continue;
    }
    if (res.status === 403 || res.status === 429 || !res.data) {
      hitError = true; // 限流或搜索错误
      continue;
    }
    // 3. 按开源/非开源过滤 + 内容安全关键词预过滤（命中即剔除）
    const bySource =
      sourceMode === "open"
        ? res.data.filter(isOpenSource)
        : sourceMode === "closed"
          ? res.data.filter((r) => !isOpenSource(r))
          : res.data;
    for (const repo of bySource) {
      if (keywordBlocked(repo.full_name, repo.description, repo.topics, safety.keywords)) {
        kwBlocked++;
        continue;
      }
      const prev = byName.get(repo.full_name);
      if (prev) {
        prev.hits = (prev.hits ?? 1) + 1;
        if (prev.hitQueries && !prev.hitQueries.includes(q)) prev.hitQueries.push(q);
      } else {
        byName.set(repo.full_name, { ...repo, hits: 1, hitQueries: [q] });
      }
    }
  }
  if (byName.size === 0 && hitError) {
    return Response.json({ error: "GitHub 搜索失败或配额不足，请稍后再试" }, { status: 502 });
  }

  // 4. 排序：popularity=按 star 降序；relevance=按命中路数降序（越被多路查询命中越相关）+ star 破平
  let repos = [...byName.values()];
  if (sortBy === "relevance") {
    repos.sort((a, b) => (b.hits ?? 0) - (a.hits ?? 0) || b.stargazers_count - a.stargazers_count);
  } else {
    repos.sort((a, b) => b.stargazers_count - a.stargazers_count);
  }
  const queryUsed = candidates[0] ?? rawQuery;

  // 3.5 内容安全 AI 兜底判定（有 key 且结果非空时）：剔除色情/暴力/涉政敏感/虚假夸大宣传的候选。
  //     失败/超时不中断（关键词层已兜底），缓存只存过滤后的结果。
  let filteredCount = 0;
  if (hasAi && repos.length > 0) {
    try {
      const excludes = await aiJudgeExcludes(query, repos);
      if (excludes.length > 0) {
        const kept = repos.filter((r) => !excludes.includes(r.full_name));
        filteredCount = repos.length - kept.length;
        repos = kept;
      }
    } catch {
      // 判定失败 → 保留关键词过滤后的结果
    }
  }

  // 4. AI 推荐说明（失败/超时不影响结果展示；候选已过安全过滤）
  let aiNote: string | null = null;
  if (hasAi && repos.length > 0) {
    try {
      aiNote = await completeChat(
        [{ role: "user", content: buildNotePrompt(query, repos) }],
        { signal: AbortSignal.timeout(30_000), reasoningEffort: "low", temperature: 0.4 },
      );
    } catch {
      aiNote = null;
    }
  }

  const matchTerms = queryTermsOf(rawQuery, queryUsed, ...candidates);
  const outRepos = repos.map((r) => ({
    full_name: r.full_name,
    description: r.description,
    language: r.language,
    stars: r.stargazers_count,
    html_url: r.html_url,
    topics: r.topics ?? [],
    license: r.license?.spdx_id ?? null,
    // 判读信号（search 响应携带，捡起零额外成本；列表判读条用）
    pushed_at: (r.pushed_at ?? "").slice(0, 10) || null,
    archived: r.archived ?? false,
    // 为什么匹配（M5 §11.1）：确定性字段级解释（话题/描述/名称/语言/多路命中），非 AI 编造
    why: explainRepoMatch(
      { full_name: r.full_name, description: r.description ?? null, topics: r.topics ?? [], language: r.language ?? null },
      matchTerms,
      r.hits,
    ),
  }));

  // 5. 缓存本次结果（有结果才缓存；命中后 6h 内同查询 + 同排序直接复用，不再消耗 token）
  if (outRepos.length > 0) {
    await saveFindResult(rawQuery, sourceMode, sortBy, { queryUsed, aiNote, repos: outRepos });
  }

  return Response.json({
    queryUsed,
    sourceMode,
    sort: sortBy,
    aiNote,
    total: repos.length,
    repos: outRepos,
    // 前端区分「没有匹配」与「匹配但被内容安全过滤」两种空态
    filtered: filteredCount > 0 || kwBlocked > 0,
  });
}

/** 最近搜索历史（前端展示，点击可复搜） */
export async function GET() {
  return Response.json({ recent: await listRecentSearches() });
}
