// GitHub REST 共享客户端（core 内部：updater / 热榜采集器 hot 共用同一套请求、限流与重试）。
// 由 updater.ts 抽出（行为逐字一致）：token 取 process.env.GITHUB_TOKEN（loadCliEnv 合并 .env.local + ai-config.json 后生效）、
// 30s 请求超时、瞬时网络错误 withRetry、搜索限流（SEARCH_STOP）由调用方按 remaining 决策。
// 零框架依赖，node ≥18 内置 fetch；web API 路由另用 lib/github.ts（语义同配额）。
export const GITHUB_API = "https://api.github.com";
/** 核心配额剩余低于此值立即停止后续请求 */
export const CORE_STOP = 8;
/** 搜索配额剩余低于此值视为不可用（等待后重试一次） */
export const SEARCH_STOP = 2;
/** 429 等待后重试的兜底秒数 */
export const RETRY_WAIT_MS = 60_000;
/** 单次请求超时（防止网络挂起导致定时任务卡死） */
export const FETCH_TIMEOUT_MS = 30_000;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 并发池：最多同时跑 limit 个任务，按数组顺序依次启动，全部完成后返回结果数组 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/**
 * 对瞬时网络错误重试（DNS/TCP 等，与 HTTP 状态码无关）。fn 抛错才触发重试；
 * HTTP 错误码（403/429/404 等）由调用方自行处理。
 */
export async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 2000): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries) throw err;
      const code = (err as { cause?: { code?: string } })?.cause?.code ?? "unknown";
      console.warn(`[重试] 网络错误（${code}），${delayMs}ms 后重试（${attempt + 1}/${retries}）`);
      await sleep(delayMs);
    }
  }
}

/** GitHub 仓库对象（Search/Repos API 返回；仅取用字段，fork/forks_count 为热榜采集所需） */
export interface GhItem {
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count?: number;
  open_issues_count?: number;
  fork?: boolean;
  created_at: string;
  topics: string[];
  html_url: string;
  pushed_at?: string | null;
  archived?: boolean;
  license?: { spdx_id: string | null } | null;
}

/** 单个仓库的判读信号字段（from repo object） */
export interface RepoInfo {
  stars: number;
  language: string | null;
  description: string | null;
  html_url: string;
  topics: string[];
  created_at: string;
  pushed_at: string | null;
  archived: boolean;
  license: string | null;
  /** M3（§9.3 事实区）：fork / open issues（旧快照缺省 → null，界面显 —） */
  forks: number | null;
  open_issues: number | null;
}

/** 从 GitHub 仓库对象中挑选需要的字段 */
export function pickRepoFields(repo: GhItem): RepoInfo {
  return {
    stars: repo.stargazers_count,
    language: repo.language ?? null,
    description: repo.description ?? null,
    html_url: repo.html_url,
    topics: Array.isArray(repo.topics) ? repo.topics : [],
    created_at: (repo.created_at ?? "").slice(0, 10),
    pushed_at: (repo.pushed_at ?? "").slice(0, 10) || null,
    archived: repo.archived ?? false,
    license: repo.license?.spdx_id ?? null,
    forks: repo.forks_count ?? null,
    open_issues: repo.open_issues_count ?? null,
  };
}

export async function ghFetch(pathname: string, { raw = false } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return fetch(`${GITHUB_API}${pathname}`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

/** 请求并返回 { res, remaining, retryAfter }，remaining 来自对应配额的 x-ratelimit-remaining */
export async function ghGet(pathname: string): Promise<{ res: Response; remaining: number; retryAfter: number }> {
  const res = await ghFetch(pathname);
  const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? Infinity);
  const retryAfter = Number(res.headers.get("retry-after"));
  return { res, remaining, retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0 };
}

/** 搜索仓库（Search API，单列限额 10 次/分钟，不占核心 60 次/小时）。perPage 最大 100 */
export async function searchRepos(
  q: string,
  perPage = 30,
): Promise<{ items: GhItem[]; ok: boolean; status: number; remaining: number }> {
  const r = await ghGet(`/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${perPage}`);
  if (!r.res.ok) return { items: [], ok: false, status: r.res.status, remaining: r.remaining };
  const data = (await r.res.json()) as { items?: GhItem[] };
  return { items: data.items ?? [], ok: true, status: r.res.status, remaining: r.remaining };
}
