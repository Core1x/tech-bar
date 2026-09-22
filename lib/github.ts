// GitHub API 封装（限流保护、缓存读取）—— 服务端专用（API 路由 / 页面）
// 注意：scripts/*.mjs 自包含实现（零依赖），本文件仅供 Next.js 运行时使用
import type { GhRepo } from './types';
import { resolveAiConfig } from './ai-config';

export const GITHUB_API_BASE = 'https://api.github.com';

/** 剩余配额低于此值时停止发起新请求 */
export const RATE_LIMIT_STOP = 8;

/** 构建请求头；token 来源：网站设置（ai-config.json）> .env.local，无需重启 */
async function githubHeaders(raw = false): Promise<HeadersInit> {
  const { githubToken } = await resolveAiConfig();
  const headers: Record<string, string> = {
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  return headers;
}

/** 读取 x-ratelimit-remaining 头；缺失时视为无限 */
export function rateLimitRemaining(res: Response): number {
  const v = res.headers.get('x-ratelimit-remaining');
  return v === null ? Infinity : parseInt(v, 10);
}

export function isRateLimited(remaining: number): boolean {
  return remaining < RATE_LIMIT_STOP;
}

export interface GhResult<T> {
  data: T | null;
  status: number;
  remaining: number;
}

/** GET 一个 API 路径，解析 JSON 并附带限流余额 */
export async function ghGetJson<T>(path: string): Promise<GhResult<T>> {
  const res = await fetch(`${GITHUB_API_BASE}${path}`, { headers: await githubHeaders(), cache: 'no-store' });
  const remaining = rateLimitRemaining(res);
  if (!res.ok) {
    return { data: null, status: res.status, remaining };
  }
  const data = (await res.json()) as T;
  return { data, status: res.status, remaining };
}

/** 取单仓库详情 */
export function getRepo(owner: string, name: string): Promise<GhResult<GhRepo>> {
  return ghGetJson<GhRepo>(`/repos/${owner}/${name}`);
}

/** 取 README 原文（raw），失败返回 null */
export async function getReadmeRaw(owner: string, name: string): Promise<{ content: string | null; status: number; remaining: number }> {
  const res = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${name}/readme`, {
    headers: await githubHeaders(true),
    cache: 'no-store',
  });
  const remaining = rateLimitRemaining(res);
  if (!res.ok) return { content: null, status: res.status, remaining };
  const content = await res.text();
  return { content, status: res.status, remaining };
}

/**
 * 取仓库内任意文件的原文（raw，默认分支）：用于 README 里链到其他语言文档/仓库内 Markdown。
 * path 为仓库相对路径，如 "README.zh.md"、"docs/guide.md"。
 */
export async function getFileRaw(
  owner: string,
  name: string,
  filePath: string,
): Promise<{ content: string | null; status: number; remaining: number }> {
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${name}/contents/${encoded}`, {
    headers: await githubHeaders(true),
    cache: 'no-store',
  });
  const remaining = rateLimitRemaining(res);
  if (!res.ok) return { content: null, status: res.status, remaining };
  const content = await res.text();
  return { content, status: res.status, remaining };
}

/** 搜索仓库，返回前 per_page 条。sortBy：popularity=按 star 降序（默认），relevance=GitHub 相关度（best match） */
export async function searchRepos(
  q: string,
  perPage = 30,
  sortBy: "popularity" | "relevance" = "popularity",
): Promise<GhResult<GhRepo[]>> {
  const sort = sortBy === "relevance" ? "" : "&sort=stars&order=desc";
  const path = `/search/repositories?q=${encodeURIComponent(q)}&per_page=${perPage}${sort}`;
  const { data, status, remaining } = await ghGetJson<{ items: GhRepo[] }>(path);
  return { data: data?.items ?? null, status, remaining };
}
