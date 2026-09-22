// AI 寻找结果缓存：同一查询（query + 开源筛选）在有效期内直接复用，避免重复消耗 AI token。
// 同时记录最近搜索历史，供前端展示、一键复搜。
import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { CACHE_DIR, atomicWrite } from "./data";

const FILE = path.join(CACHE_DIR, "find-results.json");
/** 结果缓存有效期：6 小时（榜单/趋势会变化，太久的结果不直接复用） */
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_RESULTS = 20;
const MAX_RECENT = 10;

export interface CachedFindRepo {
  full_name: string;
  description: string | null;
  language: string | null;
  stars: number;
  html_url: string;
  topics: string[];
  license: string | null;
  /** 判读信号（保持与前端 FindRepo 一致，旧缓存缺省 → 优雅隐藏判读条） */
  pushed_at?: string | null;
  archived?: boolean | null;
  /** M5「为什么匹配」字段级解释（旧缓存缺省 → 前端按「关键词命中」兜底） */
  why?: string[];
}

export interface CachedFindResult {
  queryUsed: string;
  aiNote: string | null;
  repos: CachedFindRepo[];
  ts: number;
}

interface FindCache {
  results: Record<string, CachedFindResult>;
  recent: Array<{ query: string; source: string; sort?: string; ts: number }>;
}

function cacheKey(query: string, source: string, sort?: string): string {
  return createHash("sha1").update(`${query.trim().toLowerCase()}|${source}|${sort ?? "popularity"}`).digest("hex").slice(0, 16);
}

async function read(): Promise<FindCache> {
  try {
    const obj = JSON.parse(await fs.readFile(FILE, "utf-8")) as FindCache;
    return { results: obj.results ?? {}, recent: obj.recent ?? [] };
  } catch {
    return { results: {}, recent: [] };
  }
}

async function write(cache: FindCache): Promise<void> {
  await atomicWrite(FILE, JSON.stringify(cache, null, 2));
}

// 读-改-写非原子，并发保存会互相覆盖：用模块级 promise 串行化
let mutex: Promise<void> = Promise.resolve();

/** 命中缓存则返回结果（有效期内），否则 null */
export async function getFindCache(query: string, source: string, sort?: string): Promise<CachedFindResult | null> {
  const cache = await read();
  const hit = cache.results[cacheKey(query, source, sort)];
  if (hit && Date.now() - hit.ts < TTL_MS) return hit;
  return null;
}

/** 保存一次成功的结果，并记录到最近搜索 */
export function saveFindResult(
  query: string,
  source: string,
  sort: string | undefined,
  result: Omit<CachedFindResult, "ts">,
): Promise<void> {
  const task = mutex.then(async () => {
    const cache = await read();
    const key = cacheKey(query, source, sort);
    cache.results[key] = { ...result, ts: Date.now() };

    // 结果过多时淘汰最旧的
    const keys = Object.keys(cache.results);
    if (keys.length > MAX_RESULTS) {
      keys.sort((a, b) => cache.results[a].ts - cache.results[b].ts);
      for (const k of keys.slice(0, keys.length - MAX_RESULTS)) delete cache.results[k];
    }

    // 最近搜索去重置顶
    cache.recent = [
      { query, source, sort, ts: Date.now() },
      ...cache.recent.filter((r) => !(r.query === query && r.source === source && r.sort === sort)),
    ].slice(0, MAX_RECENT);

    await write(cache);
  });
  mutex = task;
  return task;
}

/** 最近搜索历史（新的在前） */
export async function listRecentSearches(): Promise<Array<{ query: string; source: string; sort?: string; ts: number }>> {
  const cache = await read();
  return cache.recent;
}
