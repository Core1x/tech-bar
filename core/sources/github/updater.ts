// GitHub 数据更新引擎（M2 由 scripts/update-trending.mjs 逐字移植；退出码语义保留：0 成功/1 失败/2 限流提前停止）。
// 流程（幂等可重复运行）：
//   1. 读限流余额，过低退出码 2
//   1.5 异步启动 Explore 趋势榜页面抓取（github.com/trending，不占 API 配额；失败=降级不阻塞）
//   2. 两笔 Search（30 天/7 天新星）→ 合并去重 → 新星榜；await 趋势榜结果
//   3. 并发拉取追踪池详情（限流保护 + 进度写盘），算 delta_1d
//   3.5 趋势榜 Top 用 /repos 富化判读字段（配额不足则跳过，卡片优雅显示）
//   4. 池更新：新星/趋势 Top10 自动入池、池满淘汰"star 最低且近期无增长"
//   5. 写 data/latest.json（含 trending 趋势榜）与当日 data/history/{date}.json（同日重跑覆盖=幂等）
//   6. 维护 star 历史索引 data/cache/star-history.json
//   7. 摘要报告
// 数据读写一律走 core/store（file.ts）与 core/config/env；零框架依赖，node ≥18 内置 fetch。
import fs from "node:fs/promises";
import { unlinkSync } from "node:fs";
import path from "node:path";
import {
  atomicWrite,
  CACHE_DIR,
  HISTORY_DIR,
  readHistory,
  readLatest,
  readSummaries,
  readTrackedRepos,
  readWatchlist,
  STAR_HISTORY_FILE,
  writeHistory,
  writeLatest,
  writeTrackedRepos,
} from "@/core/store/file";
import { localISO, localDateStr } from "@/core/domain/calendar";
import { summaryKey } from "@/core/domain/summary";
import { loadCliEnv } from "@/core/config/env";
import type { LatestData, NewStarRepo, TrackedRepo, TrendingRepo } from "@/core/domain/types";
import { fetchTrendingRepos, type RawTrendingRepo } from "./trending";
import {
  CORE_STOP,
  RETRY_WAIT_MS,
  SEARCH_STOP,
  ghGet,
  mapLimit,
  pickRepoFields,
  searchRepos,
  sleep,
  withRetry,
  type GhItem,
  type RepoInfo,
} from "./api";

/** 进度文件：供 GET /api/update 轮询读取，UI 据此显示实时进度条 */
const PROGRESS_FILE = path.join(CACHE_DIR, "update-progress.json");

/** 追踪池上限 */
const POOL_MAX = 60;

/** 常青热门仓库：首次运行建立初始池时与新星榜前 30 名合并（约 20 个） */
const EVERGREEN = [
  "facebook/react",
  "torvalds/linux",
  "langchain-ai/langchain",
  "ollama/ollama",
  "rust-lang/rust",
  "pytorch/pytorch",
  "vllm-project/vllm",
  "microsoft/vscode",
  "kubernetes/kubernetes",
  "nodejs/node",
  "vercel/next.js",
  "golang/go",
  "huggingface/transformers",
  "microsoft/TypeScript",
  "tailwindlabs/tailwindcss",
  "vuejs/core",
  "sveltejs/svelte",
  "django/django",
  "apache/spark",
  "git/git",
];

// ---------------- 工具 ----------------

/** 写进度文件（失败不影响主流程）；UI 轮询 /api/update 读取 */
async function writeProgress(progress: { stage: string; done: number; total: number }): Promise<void> {
  try {
    await atomicWrite(PROGRESS_FILE, JSON.stringify(progress));
  } catch {
    // 忽略进度写入错误
  }
}

/**
 * 当天判读标签（保守硬旗，镜像 lib/signals.ts 的规则）。冻结进快照，供"应验"回看。
 */
function computeVerdictLabels(info: RepoInfo, dateStr: string): string[] {
  const labels: string[] = [];
  let days: number | null = null;
  if (info.pushed_at) {
    const day = 86400000;
    days = Math.max(0, Math.round((Date.parse(dateStr + "T00:00:00Z") - Date.parse(info.pushed_at + "T00:00:00Z")) / day));
  }
  if (info.archived === true) {
    labels.push("已归档");
  } else if (days !== null) {
    if (days > 365) labels.push("超1年未更新");
    else if (days >= 180) labels.push("更新放缓");
    else if (days <= 30) labels.push("活跃维护");
  }
  if (!info.license) labels.push("无开源许可证");
  return labels;
}

// ---------------- 主流程 ----------------

/**
 * 数据更新主逻辑。返回退出码：0 成功 / 1 失败 / 2 限流提前停止。
 * CLI（cli/run-source.ts）与 web「立即更新」子进程都调用本函数并按退出码结束。
 */
export async function runUpdateTrending(): Promise<number> {
  loadCliEnv();
  const today = new Date();
  const todayStr = localDateStr(today);
  console.log(`[更新] ${todayStr} 开始（${localISO(today)}）`);
  await writeProgress({ stage: "start", done: 0, total: 0 });

  // 1. 限流余额（不计费；瞬时网络错误自动重试）
  let rate: { res: Response; remaining: number; retryAfter: number };
  try {
    rate = await withRetry(() => ghGet("/rate_limit"), 2, 2000);
  } catch (err) {
    console.error(`[失败] /rate_limit 请求失败（${(err as { cause?: { code?: string } })?.cause?.code ?? "unknown"}），退出码 1`);
    return 1;
  }
  if (!rate.res.ok) {
    console.error(`[失败] /rate_limit 请求失败 HTTP ${rate.res.status}，退出码 1`);
    return 1;
  }
  const rateData = (await rate.res.json()) as { resources?: { core?: { remaining?: number; limit?: number }; search?: { remaining?: number; limit?: number } } };
  const core = rateData.resources?.core;
  const coreRemaining = core?.remaining ?? Infinity;
  console.log(
    `[限流] 核心配额剩余 ${coreRemaining}${core?.limit ? `/${core.limit}` : ""}` +
      `，搜索配额 ${rateData.resources?.search?.remaining ?? "?"}/${rateData.resources?.search?.limit ?? "?"}（每分钟）`,
  );
  if (coreRemaining < CORE_STOP) {
    console.error(`[限流] 核心配额剩余 ${coreRemaining} 低于阈值 ${CORE_STOP}，放弃本次运行（退出码 2），稍后重试`);
    return 2;
  }

  // 1.5 Explore 趋势榜抓取与搜索并行（github.com 页面，不占 API 配额；内部已捕获错误返回 null）
  const trendingPromise = fetchTrendingRepos();

  // 2. 两笔搜索 → 合并去重 → 新星榜
  const daysAgo = (n: number, base: Date) => {
    const d = new Date(base);
    d.setDate(d.getDate() - n);
    return localDateStr(d);
  };
  const queries = [
    { label: "近30天", q: `created:>${daysAgo(30, today)}` },
    { label: "近7天", q: `created:>${daysAgo(7, today)}` },
  ];

  const byName = new Map<string, GhItem>(); // 合并去重，A 查询（更长时间窗）优先
  for (const { label, q } of queries) {
    let r: { items: GhItem[]; ok: boolean; status: number; remaining: number };
    try {
      r = await withRetry(() => searchRepos(q, 30), 1, 2000);
    } catch (err) {
      console.error(`[失败] 搜索「${label}」网络错误（${(err as { cause?: { code?: string } })?.cause?.code ?? "unknown"}），跳过本路，用另一路兜底`);
      continue;
    }
    if (!r.ok) {
      if (r.status === 403 || r.status === 429 || r.remaining < SEARCH_STOP) {
        console.error(`[限流] 搜索「${label}」受限（HTTP ${r.status}，剩余 ${r.remaining}），等待 ${RETRY_WAIT_MS / 1000}s 重试一次`);
        await sleep(RETRY_WAIT_MS);
        const retry = await searchRepos(q, 30);
        if (!retry.ok) {
          console.error(`[限流] 重试后仍失败，放弃本次运行（退出码 2）`);
          return 2;
        }
        for (const item of retry.items) {
          if (!byName.has(item.full_name)) byName.set(item.full_name, item);
        }
      } else {
        console.error(`[失败] 搜索「${label}」HTTP ${r.status}，跳过本路，用另一路兜底`);
        continue;
      }
    } else {
      for (const item of r.items) {
        if (!byName.has(item.full_name)) byName.set(item.full_name, item);
      }
    }
  }
  if (byName.size === 0) {
    console.error(`[失败] 两路搜索均失败，无新星数据（退出码 1）`);
    return 1;
  }

  const newStarList: NewStarRepo[] = [...byName.values()]
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 30)
    .map((repo, i) => ({
      rank: i + 1,
      full_name: repo.full_name,
      description: repo.description ?? null,
      language: repo.language ?? null,
      stars: repo.stargazers_count,
      created_at: (repo.created_at ?? "").slice(0, 10),
      topics: repo.topics ?? [],
      html_url: repo.html_url,
      delta_1d: null,
      pushed_at: (repo.pushed_at ?? "").slice(0, 10) || null,
      archived: repo.archived ?? false,
      license: repo.license?.spdx_id ?? null,
      forks: repo.forks_count ?? null,
      open_issues: repo.open_issues_count ?? null,
    }));
  console.log(`[搜索] 新星榜合并去重后 ${newStarList.length} 个（近30天 Top，含近7天重复过滤）`);

  const trendingRaw: RawTrendingRepo[] | null = await trendingPromise;
  if (trendingRaw) console.log(`[趋势] Explore 趋势榜抓到 ${trendingRaw.length} 个（当日新增 star 口径）`);

  // 2.5 快路径落盘：榜单（新星 + 趋势榜页面原始数据）先写 latest.json，追踪池沿用上一次——
  // 更新开跑后十几秒首页/板块即可见新榜单，不再等池详情几分钟；池与富化完成后由步骤 6 全量覆盖（终写）。
  try {
    const prevLatest = await readLatest();
    const fastSummaries = await readSummaries();
    for (const s of newStarList) {
      s.summary = fastSummaries[summaryKey(s.full_name, s.description ?? "")] ?? null;
    }
    const fastTrending: TrendingRepo[] | undefined = trendingRaw
      ? trendingRaw.slice(0, 25).map((t) => ({
          rank: t.rank,
          full_name: t.full_name,
          description: t.description,
          language: t.language,
          stars: t.stars,
          stars_today: t.stars_today,
          forks: t.forks,
          html_url: t.html_url,
          summary: fastSummaries[summaryKey(t.full_name, t.description ?? "")] ?? null,
        }))
      : prevLatest?.trending;
    await writeLatest({
      updated_at: localISO(new Date()),
      date: todayStr,
      new_stars: newStarList,
      tracked: prevLatest?.tracked ?? [],
      tracked_updated: prevLatest?.tracked_updated ?? 0,
      trending: fastTrending,
    });
    console.log(`[快路径] 榜单已先行落盘（新星 ${newStarList.length}${trendingRaw ? " + 趋势榜" : ""}，追踪池沿用上次），终写稍后覆盖`);
  } catch (err) {
    console.warn(`[快路径] 先行落盘失败（不影响主流程，等终写）：${(err as Error).message}`);
  }

  // 3. 追踪池准备：首次运行建初始池；新星榜/趋势榜 Top 10 自动入池
  //    M2（§8.3）：本轮拉取集合 = 池 ∪ 关注中的 GitHub 仓库——关注仓库参与采样（进 latest.tracked/
  //    history/star-history 积累趋势），但**不写入 tracked-repos.json**（那是用户手工池，
  //    取消关注不会误删固定仓库，也不把关注行为混进配置真相源）。
  let pool = await readTrackedRepos();
  if (pool.length === 0) {
    pool = [
      ...newStarList.slice(0, 30).map((r) => r.full_name),
      ...EVERGREEN.filter((n) => !newStarList.slice(0, 30).some((r) => r.full_name === n)),
    ].slice(0, POOL_MAX);
    console.log(`[池] 首次运行，建立初始池 ${pool.length} 个（新星榜前30 + 常青仓库）`);
  }
  // top10 = 新星榜与趋势榜各取前 10 的并集（自动入池 + 免淘汰保护）
  const top10 = new Set([
    ...newStarList.slice(0, 10).map((r) => r.full_name),
    ...(trendingRaw?.slice(0, 10).map((r) => r.full_name) ?? []),
  ]);
  const newlyAdded: string[] = [];
  for (const name of top10) {
    if (!pool.includes(name)) {
      pool.push(name);
      newlyAdded.push(name);
    }
  }
  if (newlyAdded.length > 0) console.log(`[池] 新星/趋势 Top10 自动入池：${newlyAdded.join(", ")}`);

  // M2（§8.3）：本轮拉取集合 = 配置池 ∪ 关注中的 GitHub 仓库。关注仓库参与逐日采样
  // （进 latest.tracked / history / star-history 积累趋势），但**不写进 tracked-repos.json**——
  // 该文件是用户手工/自动池的真相源，取消关注不触碰它，固定追踪仓库永不受关注操作影响。
  const watchGithub = new Set(
    (await readWatchlist())
      .filter((e) => e.source === "github")
      .map((e) => e.source_id),
  );
  const watchOnly = [...watchGithub].filter((n) => !pool.includes(n));
  if (watchOnly.length > 0) console.log(`[池] 关注仓库参与采样（不落配置池）：${watchOnly.join(", ")}`);
  let fetchPool = [...new Set([...pool, ...watchGithub])];

  // 4. 并发拉取追踪池详情（限流保护 + 进度写盘）
  let prevSnapshotDate: string | null = null;
  try {
    const files = (await fs.readdir(HISTORY_DIR))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, 10))
      .filter((d) => d < todayStr)
      .sort();
    prevSnapshotDate = files.pop() ?? null;
  } catch {
    // history 目录不存在
  }
  const prevSnapshot = prevSnapshotDate ? await readHistory(prevSnapshotDate) : null;
  console.log(`[对比] delta 基准快照：${prevSnapshotDate ?? "无（首次运行，delta 显示 —）"}`);
  const yesterdayStars = new Map((prevSnapshot?.repos ?? []).map((r) => [r.full_name, r.stars]));

  const todayRepo = new Map<string, RepoInfo>();
  let stopped = false;
  let remaining = coreRemaining;
  const removed404: string[] = [];

  const concurrency = coreRemaining > 200 ? 6 : 2;
  await writeProgress({ stage: "fetch", done: 0, total: fetchPool.length });

  let done = 0; // 已处理条数（含成功/跳过），用于进度显示
  const fetchRepo = async (fullName: string) => {
    if (stopped) return;
    let r: { res: Response; remaining: number; retryAfter: number };
    try {
      r = await ghGet(`/repos/${fullName}`);
    } catch (err) {
      const code = (err as { cause?: { code?: string } })?.cause?.code ?? "unknown";
      console.warn(`[重试] ${fullName} 网络错误（${code}），2s 后重试一次`);
      await sleep(2000);
      try {
        r = await ghGet(`/repos/${fullName}`);
      } catch (err2) {
        const code2 = (err2 as { cause?: { code?: string } })?.cause?.code ?? "unknown";
        console.warn(`[跳过] ${fullName} 网络重试仍失败（${code2}），跳过`);
        done++;
        await writeProgress({ stage: "fetch", done, total: fetchPool.length });
        return;
      }
    }
    let rem = r.remaining;

    if (!r.res.ok) {
      if (r.res.status === 404) {
        removed404.push(fullName);
        console.warn(`[跳过] ${fullName} 不存在（404），从池中移除`);
        done++;
        await writeProgress({ stage: "fetch", done, total: fetchPool.length });
        return;
      }
      if (r.res.status === 429 || (r.res.status === 403 && rem < CORE_STOP)) {
        const wait = Math.min(Math.max(r.retryAfter || RETRY_WAIT_MS / 1000, 30), 120);
        if (rem >= CORE_STOP) {
          console.warn(`[重试] ${fullName} HTTP ${r.res.status}，等待 ${wait}s 后重试一次`);
          await sleep(wait * 1000);
          const r2 = await ghGet(`/repos/${fullName}`);
          rem = r2.remaining;
          if (r2.res.ok) {
            const repo = (await r2.res.json()) as GhItem;
            todayRepo.set(fullName, pickRepoFields(repo));
            console.log(`[详情] ${done + 1}/${pool.length} ${fullName} ★${repo.stargazers_count}`);
          } else {
            console.warn(`[失败] ${fullName} 重试仍失败（HTTP ${r2.res.status}）`);
          }
        } else {
          stopped = true;
          console.error(`[限流] 剩余 ${rem} 低于阈值 ${CORE_STOP}，停止后续请求`);
          done++;
          await writeProgress({ stage: "fetch", done, total: fetchPool.length });
          return;
        }
      } else {
        console.warn(`[失败] ${fullName} HTTP ${r.res.status}，跳过`);
      }
    } else {
      const repo = (await r.res.json()) as GhItem;
      todayRepo.set(fullName, pickRepoFields(repo));
      console.log(`[详情] ${done + 1}/${pool.length} ${fullName} ★${repo.stargazers_count}`);
    }

    if (rem < CORE_STOP) {
      stopped = true;
      console.error(`[限流] 剩余 ${rem} 低于阈值 ${CORE_STOP}，停止后续请求`);
    }
    remaining = rem;
    done++;
    await writeProgress({ stage: "fetch", done, total: fetchPool.length });
  };

  await mapLimit(fetchPool, concurrency, fetchRepo);
  if (removed404.length > 0) {
    pool = pool.filter((n) => !removed404.includes(n));
    fetchPool = fetchPool.filter((n) => !removed404.includes(n));
    console.log(`[池] 移除 404 仓库后剩 ${pool.length} 个`);
  }

  // 3.5 Explore 趋势榜详情富化：用 /repos 补齐 topics/created/pushed/archived/license（判读 chips 与标签用）。
  // 独立局部停止标志：趋势富化耗尽配额不算整轮"部分失败"（榜单本身已有页面数据，判读字段优雅缺省）。
  let trendingList: TrendingRepo[] | null = null;
  if (trendingRaw && trendingRaw.length > 0) {
    const missing = trendingRaw.filter((t) => !todayRepo.has(t.full_name)).map((t) => t.full_name);
    let enrichStopped = false;
    if (missing.length > 0 && remaining > CORE_STOP + missing.length) {
      let tDone = 0;
      await writeProgress({ stage: "trending", done: 0, total: missing.length });
      await mapLimit(missing, remaining > 200 ? 6 : 2, async (fullName) => {
        if (enrichStopped) return;
        try {
          const r = await ghGet(`/repos/${fullName}`);
          remaining = r.remaining;
          if (r.res.ok) {
            const repo = (await r.res.json()) as GhItem;
            todayRepo.set(fullName, pickRepoFields(repo));
          }
          if (remaining < CORE_STOP) {
            enrichStopped = true;
            console.error(`[限流] 趋势富化中断（剩余 ${remaining}），后续条目无判读字段显示`);
          }
        } catch {
          // 单仓网络失败 → 该仓详情缺省，卡片优雅隐藏 chips
        }
        tDone++;
        await writeProgress({ stage: "trending", done: tDone, total: missing.length });
      });
    } else if (missing.length > 0) {
      console.warn(`[趋势] 核心配额剩余 ${remaining} 不足以富化 ${missing.length} 仓，跳过（判读字段缺省显示）`);
    }
    trendingList = trendingRaw.slice(0, 25).map((t) => {
      const info = todayRepo.get(t.full_name);
      return {
        rank: t.rank,
        full_name: t.full_name,
        description: t.description,
        language: info?.language ?? t.language,
        stars: info?.stars ?? t.stars,
        stars_today: t.stars_today,
        forks: t.forks,
        html_url: t.html_url,
        topics: info?.topics,
        created_at: info?.created_at,
        pushed_at: info?.pushed_at ?? null,
        archived: info?.archived,
        license: info?.license,
        open_issues: info?.open_issues ?? null,
      };
    });
    const enriched = trendingList.filter((t) => t.topics !== undefined).length;
    console.log(`[趋势] 榜单 ${trendingList.length} 个，其中 ${enriched} 个已富化判读字段`);
  }

  // 5. 池更新：池满 60 且需要为新星腾位置时，淘汰「总 star 最低且近期无增长」的条目
  if (pool.length > POOL_MAX) {
    const candidates = pool
      .filter((n) => !top10.has(n) && todayRepo.has(n))
      .sort((a, b) => {
        const infoA = todayRepo.get(a)!;
        const infoB = todayRepo.get(b)!;
        const da = yesterdayStars.has(a) ? infoA.stars - yesterdayStars.get(a)! : 0;
        const db = yesterdayStars.has(b) ? infoB.stars - yesterdayStars.get(b)! : 0;
        if (da !== db) return da - db;
        return infoA.stars - infoB.stars;
      });
    while (pool.length > POOL_MAX && candidates.length > 0) {
      const victim = candidates.shift()!;
      pool = pool.filter((n) => n !== victim);
      console.log(`[池] 池满 ${POOL_MAX}，淘汰「总 star 最低且近期无增长」的 ${victim}`);
    }
  }
  await writeTrackedRepos([...new Set(pool)]);

  // 6. 组装并写 latest.json 与当日 history 快照（同日重跑直接覆盖，幂等）
  const deltaOf = (fullName: string) => {
    const info = todayRepo.get(fullName);
    if (!info) return null;
    const y = yesterdayStars.get(fullName);
    return y === undefined ? null : info.stars - y;
  };

  const tracked: TrackedRepo[] = fetchPool
    .flatMap((n): TrackedRepo[] => {
      const info = todayRepo.get(n);
      if (info) {
        return [{
          full_name: n,
          stars: info.stars,
          delta_1d: deltaOf(n),
          language: info.language,
          description: info.description,
          html_url: info.html_url,
          topics: info.topics,
          created_at: info.created_at,
          pushed_at: info.pushed_at ?? null,
          archived: info.archived ?? false,
          license: info.license ?? null,
          forks: info.forks ?? null,
          open_issues: info.open_issues ?? null,
        }];
      }
      // M2（§8.3 限流/失败）：沿用最近一次已知数据并标注其抓取时刻（dataUpdatedAt），
      // delta 置 null——不把旧数据显示成"刚更新"。来源=昨日 history 快照（若有该仓）。
      const prev = (prevSnapshot?.repos ?? []).find((r) => r.full_name === n);
      if (!prev) return [];
      return [{
        full_name: n,
        stars: prev.stars,
        delta_1d: null,
        language: prev.language,
        description: prev.description,
        html_url: `https://github.com/${n}`,
        topics: prev.topics,
        created_at: prev.created_at,
        pushed_at: prev.pushed_at ?? null,
        archived: prev.archived ?? false,
        license: prev.license ?? null,
        dataUpdatedAt: prevSnapshot!.date,
      }];
    })
    .sort((a, b) => (b.delta_1d ?? -1) - (a.delta_1d ?? -1));

  for (const s of newStarList) s.delta_1d = deltaOf(s.full_name);

  // 合并中文摘要缓存（summarize 写入；键 = full_name + 描述哈希）
  const summaries = await readSummaries();
  for (const s of newStarList) {
    s.summary = summaries[summaryKey(s.full_name, s.description ?? "")] ?? null;
  }
  for (const t of tracked) {
    t.summary = summaries[summaryKey(t.full_name, t.description ?? "")] ?? null;
  }
  if (trendingList) {
    for (const t of trendingList) {
      t.summary = summaries[summaryKey(t.full_name, t.description ?? "")] ?? null;
    }
  }

  const latest: LatestData = {
    updated_at: localISO(today),
    date: todayStr,
    new_stars: newStarList,
    tracked,
    // M2：回退 last-known 行（dataUpdatedAt 旧）不算"本轮更新到"
    tracked_updated: tracked.filter((t) => !t.dataUpdatedAt).length,
    trending: trendingList ?? undefined,
  };
  await writeLatest(latest);

  await writeHistory({
    date: todayStr,
    repos: fetchPool
      .filter((n) => todayRepo.has(n))
      .map((n) => {
        const info = todayRepo.get(n)!;
        return {
          full_name: n,
          stars: info.stars,
          language: info.language,
          description: info.description,
          topics: info.topics,
          created_at: info.created_at,
          pushed_at: info.pushed_at ?? null,
          archived: info.archived ?? false,
          license: info.license ?? null,
          verdict: computeVerdictLabels(info, todayStr),
        };
      }),
  });

  // 6.5 维护 star 历史索引（data/cache/star-history.json）
  // 结构：{ meta: { latestDate }, repos: { full_name: [{ date, stars }] } }
  let starIndex = { meta: { latestDate: todayStr }, repos: {} as Record<string, { date: string; stars: number }[]> };
  try {
    const raw = await fs.readFile(STAR_HISTORY_FILE, "utf-8");
    const existing = JSON.parse(raw) as { meta?: { latestDate?: string }; repos?: Record<string, { date: string; stars: number }[]> };
    if (existing && typeof existing === "object" && existing.repos && typeof existing.repos === "object") {
      starIndex = { meta: { latestDate: existing.meta?.latestDate ?? todayStr }, repos: existing.repos };
    }
  } catch {
    // 索引不存在或损坏 → 从当天重新开始
  }
  for (const n of fetchPool) {
    const info = todayRepo.get(n);
    if (!info) continue;
    const list = starIndex.repos[n] ?? [];
    const last = list[list.length - 1];
    if (last && last.date === todayStr) {
      last.stars = info.stars; // 同日重跑：覆盖而非追加（保持幂等）
    } else {
      list.push({ date: todayStr, stars: info.stars });
    }
    starIndex.repos[n] = list;
  }
  starIndex.meta.latestDate = todayStr;
  await atomicWrite(STAR_HISTORY_FILE, JSON.stringify(starIndex, null, 2) + "\n");

  // 7. 摘要报告
  console.log("\n=== 更新报告 ===");
  for (const r of newStarList.slice(0, 5)) {
    console.log(`#${r.rank} ${r.full_name} ★${r.stars} ${r.language ?? ""}`);
  }
  console.log(`Explore 趋势榜：${trendingList?.length ?? 0} 个${trendingList ? "" : "（抓取失败，feed 回落新星榜口径）"}`);
  console.log(`追踪池：${tracked.length}/${fetchPool.length}（配置池 ${pool.length} + 关注额外 ${fetchPool.length - pool.length}），本轮更新 ${tracked.filter((t) => !t.dataUpdatedAt).length} 个（${stopped ? "部分" : "全部"}）`);
  console.log(`核心配额剩余：${remaining}`);
  if (stopped) {
    console.error("[限流] 配额耗尽提前停止（退出码 2），已完成部分已保存，下次运行自动补齐");
  } else {
    console.log("[完成] 数据已写入 data/latest.json 与 data/history/" + todayStr + ".json");
  }
  return stopped ? 2 : 0;
}

// 退出时兜底清理进度文件，避免残留旧进度在下次轮询中被误显示（与旧脚本一致）
process.on("exit", () => {
  try {
    unlinkSync(PROGRESS_FILE);
  } catch {
    // 文件不存在等，忽略
  }
});
