// GitHub 热榜采集器（存量榜，运行期零 AI）：读类目配置 → 每类目 1–3 笔 searchRepos（sort=stars，
// stars:>=生效门槛 直接进查询式，故只回达标仓库）→ README 探测（best-effort、缓存、404 才判"确无"）
// → 纯函数装配过滤（core/domain/hot-filter，仅技术性规则）→ 挂已有中文摘要 → 全量重建
// data/hot/latest.json + 当日 history。退出码语义与 GitHub 更新一致：0 成功 / 1 失败 / 2 限流部分完成。
// 复用 core/sources/github/api.ts 的 token/超时/重试/限流；不引第三方库。
import { loadCliEnv } from "@/core/config/env";
import { readHotCategories, effectiveStarFloor } from "@/core/config/hot-categories";
import {
  assembleHotSections,
  type HotAssembleCategory,
} from "@/core/domain/hot-filter";
import { localDateStr, localISO } from "@/core/domain/calendar";
import { summaryKey } from "@/core/domain/summary";
import {
  readHotReadmeCache,
  readSummaries,
  writeHotLatest,
  writeHotReadmeCache,
} from "@/core/store/file";
import type { HotCategorySection, HotFilteredEntry, HotLatest, HotRepo } from "@/core/domain/types";
import {
  RETRY_WAIT_MS,
  SEARCH_STOP,
  ghGet,
  searchRepos,
  sleep,
  withRetry,
  type GhItem,
} from "./api";

/** 每笔搜索取回条数（GitHub Search per_page 上限 100） */
const PER_PAGE = 100;
/** 每类目入榜上限（控快照体积 + 摘要成本；类目内按 star 降序取前 N） */
const CATEGORY_MAX = 80;
/** 相邻搜索节流（认证搜索配额 30/分钟，留足余量；配合每请求 ~1-2s 往返实测约 <20/分钟） */
const SEARCH_SPACING_MS = 1600;
/** 单轮 README 探测上限（核心配额；缓存后多为命中、实际很少触网） */
const PROBE_CAP = 300;
/** README 探测节流（核心配额二级限流：滥用检测对连续快请求敏感） */
const README_PROBE_SPACING_MS = 150;
/** 核心配额剩余低于此值即停止 README 探测（未知 → 保留，不误伤） */
const CORE_PROBE_MIN = 20;

/** Search 结果映射后的原始热榜条目（含过滤所需 fork/forks/readme；readme 探测后回填） */
type HotRawItem = HotAssembleCategory["items"][number];

function mapGhItem(it: GhItem): HotRawItem {
  return {
    full_name: it.full_name,
    description: it.description ?? null,
    topics: Array.isArray(it.topics) ? it.topics : [],
    stars: it.stargazers_count,
    language: it.language ?? null,
    forks: typeof it.forks_count === "number" ? it.forks_count : null,
    html_url: it.html_url,
    created_at: (it.created_at ?? "").slice(0, 10),
    pushed_at: (it.pushed_at ?? "").slice(0, 10) || null,
    archived: it.archived ?? false,
    license: it.license?.spdx_id ?? null,
    fork: it.fork ?? false,
  };
}

function toHotRepo(it: HotRawItem, rank: number, summaries: Record<string, string>): HotRepo {
  return {
    rank,
    full_name: it.full_name,
    description: it.description,
    summary: summaries[summaryKey(it.full_name, it.description ?? "")] ?? null,
    language: it.language,
    stars: it.stars,
    forks: it.forks ?? null,
    html_url: it.html_url,
    topics: it.topics,
    created_at: it.created_at,
    pushed_at: it.pushed_at,
    archived: it.archived ?? null,
    license: it.license ?? null,
  };
}

export interface HotRebuildResult {
  /** 0 成功 / 1 失败（无配置等）/ 2 限流部分完成 */
  code: number;
  categoryCount: number;
  kept: number;
  filtered: number;
  message: string;
}

/**
 * 逐类目跑查询式（stars:>=生效门槛），返回原始召回板块（未过滤/未探 README）。
 * 供 rebuild（写）与 probe（读体检）复用，避免重试/限流逻辑两处漂移。
 * 每笔搜索后节流；受限则等一次并重试；网络/查询式无效 → 记 partial 并跳过该式。
 */
export async function collectHotSections(): Promise<{
  sections: HotAssembleCategory[];
  /** true = 有搜索失败/受限（调用方据此决定退出码/告警口径） */
  partial: boolean;
}> {
  const cats = await readHotCategories();
  const sections: HotAssembleCategory[] = [];
  let partial = false;
  for (const cat of cats) {
    const floor = effectiveStarFloor(cat);
    const items: HotRawItem[] = [];
    for (const q of cat.queries) {
      const fullQ = `${q} stars:>=${floor}`;
      let r: { items: GhItem[]; ok: boolean; status: number; remaining: number };
      try {
        r = await withRetry(() => searchRepos(fullQ, PER_PAGE), 1, 2000);
      } catch (err) {
        partial = true;
        console.error(`[热榜] 「${cat.label}」搜索网络错误（${(err as { cause?: { code?: string } })?.cause?.code ?? "unknown"}），跳过该查询式`);
        continue;
      }
      if (!r.ok) {
        if (r.status === 403 || r.status === 429 || r.remaining < SEARCH_STOP) {
          console.warn(`[热榜] 「${cat.label}」搜索受限（HTTP ${r.status}，剩余 ${r.remaining}），等 ${RETRY_WAIT_MS / 1000}s 重试一次`);
          await sleep(RETRY_WAIT_MS);
          r = await searchRepos(fullQ, PER_PAGE);
          if (!r.ok) {
            partial = true;
            console.error(`[热榜] 重试仍失败，跳过「${q}」`);
            continue;
          }
        } else {
          partial = true;
          console.error(`[热榜] 「${cat.label}」搜索 HTTP ${r.status}（查询式可能无效），跳过`);
          continue;
        }
      }
      for (const it of r.items) items.push(mapGhItem(it));
      await sleep(SEARCH_SPACING_MS);
    }
    sections.push({ id: cat.id, label: cat.label, starFloor: floor, items });
    console.log(`[热榜]   ${cat.label}：召回 ${items.length} 条（生效门槛 ★${floor}）`);
  }
  return { sections, partial };
}

/**
 * 全量重建热榜快照。纯运行期（无 AI）；约 每类目 1–3 笔搜索，配额占用极小。
 * 无类目配置 → code 1 并提示先跑生成命令。搜索受限/网络失败 → code 2（已并入部分照常落盘）。
 */
export async function rebuildHotSnapshot(): Promise<HotRebuildResult> {
  loadCliEnv();
  const cats = await readHotCategories();
  if (cats.length === 0) {
    return {
      code: 1,
      categoryCount: 0,
      kept: 0,
      filtered: 0,
      message: "无类目配置：先跑生成/体检命令产出 data/config/hot-categories.json 再重建",
    };
  }

  const today = new Date();
  const date = localDateStr(today);
  console.log(`[热榜] ${date} 开始重建（${cats.length} 类目）`);

  const { sections, partial: searchPartial } = await collectHotSections();
  let partial = searchPartial;

  // ---- README 探测（核心配额、best-effort、缓存；命中缓存零请求）----
  const readmeCache = await readHotReadmeCache();
  const toProbe = new Set<string>();
  for (const sec of sections) {
    for (const it of sec.items) {
      // 只对"可能保留"的候选探测 README（省配额）；已缓存的跳过
      if (it.description && !it.archived && !it.fork && !(it.full_name in readmeCache)) toProbe.add(it.full_name);
    }
  }

  const probeList = [...toProbe].slice(0, PROBE_CAP);
  if (probeList.length > 0) {
    let coreLeft = Infinity;
    for (const fullName of probeList) {
      if (coreLeft < CORE_PROBE_MIN) {
        partial = true;
        console.warn(`[热榜] 核心配额偏低（剩余 ${coreLeft}），跳过余下 README 探测（未知 → 保留）`);
        break;
      }
      try {
        const { res, remaining } = await ghGet(`/repos/${fullName}/readme`);
        coreLeft = remaining;
        if (res.status === 404) readmeCache[fullName] = "n";
        else if (res.ok) readmeCache[fullName] = "y";
        else if (res.status === 403 || res.status === 429) {
          // 二级限流 / 滥用检测：立即停探（余下未知 → 保留），记 partial，不硬刚
          partial = true;
          console.warn(`[热榜] README 探测被限流（HTTP ${res.status}），停止探测（未知 → 保留）`);
          break;
        }
        // 其它状态（超时/5xx）→ 不写缓存（未知）
      } catch {
        // 网络错误 → 未知，保留
      }
      await sleep(README_PROBE_SPACING_MS); // 节流，避免二级限流
    }
    await writeHotReadmeCache(readmeCache);
  }
  for (const sec of sections) {
    for (const it of sec.items) {
      const v = readmeCache[it.full_name];
      if (v === "y" || v === "n") it.readme = v;
    }
  }

  // ---- 装配过滤（纯函数，仅技术性规则）+ 挂摘要 + 入榜截断 ----
  const assembled = assembleHotSections(sections);
  const summaries = (await readSummaries()) ?? {};
  const categories: HotCategorySection[] = assembled.categories.map((sec) => ({
    id: sec.id,
    label: sec.label,
    items: sec.items.slice(0, CATEGORY_MAX).map((it, i) => toHotRepo(it, i + 1, summaries)),
  }));
  const filtered: HotFilteredEntry[] = assembled.filtered;

  const snapshot: HotLatest = { updated_at: localISO(today), date, categories, filtered };
  await writeHotLatest(snapshot);

  const kept = categories.reduce((n, c) => n + c.items.length, 0);
  const message = partial
    ? `热榜重建部分完成（限流/个别查询式失败）：${kept} 入榜 / ${filtered.length} 出榜`
    : `热榜重建完成：${kept} 入榜 / ${filtered.length} 出榜`;
  console.log(`[热榜] ${message}`);
  return { code: partial ? 2 : 0, categoryCount: categories.length, kept, filtered: filtered.length, message };
}
