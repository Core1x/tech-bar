// AI 寻找项目的全局状态（Provider 挂在根布局）：
// 切页（组件卸载）后结果仍保留，直到下一次寻找开始才被新的结果替换。
"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type SourceMode = "all" | "open" | "closed";
export type SortMode = "popularity" | "relevance";

/** M5 §11.1 结果筛选（客户端即时过滤，不重发请求；持久化策略与结果一致——刷新后保留） */
export interface FindFilters {
  /** null=不限语言 */
  language: string | null;
  /** 0=不限最低 star */
  minStars: number;
  /** null=不限更新；否则仅推送于 N 天内（pushed_at 未采集的会被排除） */
  pushedWithinDays: number | null;
  /** any=不限；yes=许可证明确；no=无明确许可证 */
  license: "any" | "yes" | "no";
  /** 隐藏归档仓库 */
  hideArchived: boolean;
}

export const DEFAULT_FILTERS: FindFilters = {
  language: null,
  minStars: 0,
  pushedWithinDays: null,
  license: "any",
  hideArchived: false,
};

export function isDefaultFilters(f: FindFilters): boolean {
  return f.language === null && f.minStars === 0 && f.pushedWithinDays === null && f.license === "any" && !f.hideArchived;
}

/** 对单条结果应用筛选（纯函数，供列表与计数共用） */
export function passFilter(repo: FindRepo, f: FindFilters): boolean {
  if (f.language && (repo.language ?? "").toLowerCase() !== f.language.toLowerCase()) return false;
  if (f.minStars > 0 && repo.stars < f.minStars) return false;
  if (f.pushedWithinDays !== null) {
    if (!repo.pushed_at) return false;
    const days = (Date.now() - Date.parse(repo.pushed_at)) / 86_400_000;
    if (!(days <= f.pushedWithinDays)) return false;
  }
  if (f.license === "yes" && !repo.license) return false;
  if (f.license === "no" && repo.license) return false;
  if (f.hideArchived && repo.archived === true) return false;
  return true;
}

type RecentItem = { query: string; source: SourceMode; sort?: SortMode };

/** 旧数据 sort 缺省(=默认人气) 归一为 popularity */
function normSort(s?: string): SortMode {
  return s === "relevance" ? "relevance" : "popularity";
}

/** recent 去重：按「query+source+归一sort」唯一（处理 localStorage 旧数据/服务端残留的重复，消除 React key 冲突） */
function dedupeRecent(list: RecentItem[]): RecentItem[] {
  const seen = new Set<string>();
  const out: RecentItem[] = [];
  for (const r of list) {
    const key = `${r.query}|${r.source}|${normSort(r.sort)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ query: r.query, source: r.source, sort: normSort(r.sort) });
  }
  return out;
}

export interface FindRepo {
  full_name: string;
  description: string | null;
  language: string | null;
  stars: number;
  html_url: string;
  topics: string[];
  license: string | null;
  /** 判读信号（详情/列表判读条用；旧缓存命中缺省 → 判读条优雅隐藏） */
  pushed_at?: string | null;
  archived?: boolean | null;
  /** M5「为什么匹配」字段级解释（旧缓存无此字段 → 前端显示来源统计兜底） */
  why?: string[];
}

export interface FindResult {
  aiNote: string | null;
  queryUsed: string;
  repos: FindRepo[];
  /** 结果是否为「有匹配但被内容安全过滤后为空」 */
  filtered: boolean;
}

interface FindStoreValue {
  query: string;
  source: SourceMode;
  sort: SortMode;
  filters: FindFilters;
  result: FindResult | null;
  busy: boolean;
  error: string | null;
  recent: Array<{ query: string; source: SourceMode; sort?: SortMode }>;
  setQuery: (q: string) => void;
  setSource: (s: SourceMode) => void;
  setSort: (s: SortMode) => void;
  setFilters: (f: FindFilters) => void;
  runFind: (q: string, src: SourceMode, sortMode?: SortMode) => Promise<void>;
}

const Ctx = createContext<FindStoreValue | null>(null);

// ---- 持久化：结果存入 localStorage，刷新浏览器页面后仍保留 ----
const STORAGE_KEY = "find:state";

interface PersistedFindState {
  query: string;
  source: SourceMode;
  sort?: SortMode;
  filters?: FindFilters;
  result: FindResult | null;
  recent: Array<{ query: string; source: SourceMode; sort?: SortMode }>;
}

function savePersisted(s: PersistedFindState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // localStorage 不可用（隐私模式等）时忽略
  }
}

function loadPersisted(): PersistedFindState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PersistedFindState>;
    if (typeof p.query !== "string" || !Array.isArray(p.recent)) return null;
    const f = p.filters;
    const filters: FindFilters =
      f && typeof f === "object"
        ? {
            language: typeof f.language === "string" ? f.language : null,
            minStars: typeof f.minStars === "number" && f.minStars >= 0 ? f.minStars : 0,
            pushedWithinDays:
              typeof f.pushedWithinDays === "number" && f.pushedWithinDays > 0 ? f.pushedWithinDays : null,
            license: f.license === "yes" || f.license === "no" ? f.license : "any",
            hideArchived: f.hideArchived === true,
          }
        : { ...DEFAULT_FILTERS };
    return {
      query: p.query,
      source: p.source === "open" || p.source === "closed" ? p.source : "all",
      sort: p.sort === "relevance" ? "relevance" : "popularity",
      filters,
      result: p.result ?? null,
      recent: dedupeRecent(p.recent),
    };
  } catch {
    return null;
  }
}

export function FindProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceMode>("all");
  const [sort, setSort] = useState<SortMode>("popularity");
  const [filters, setFilters] = useState<FindFilters>(DEFAULT_FILTERS);
  const [result, setResult] = useState<FindResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Array<{ query: string; source: SourceMode; sort?: SortMode }>>([]);

  // 加载最近搜索记录（缓存命中会直接复用结果，不再消耗 token）
  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch("/api/find");
      if (!res.ok) return;
      const j = (await res.json()) as { recent?: Array<{ query: string; source: string; sort?: string }> };
      if (Array.isArray(j.recent)) {
        setRecent(
          dedupeRecent(
            j.recent.map((r) => ({
              query: r.query,
              source: (r.source as SourceMode) || "all",
              sort: normSort(r.sort),
            })),
          ),
        );
      }
    } catch {
      // 忽略
    }
  }, []);

  useEffect(() => {
    // setTimeout 延后到 hydration 完成后：恢复 localStorage 状态 + 加载最近搜索
    const t = setTimeout(() => {
      const p = loadPersisted();
      if (p) {
        setQuery(p.query);
        setSource(p.source);
        setSort(p.sort ?? "popularity");
        if (p.filters) setFilters(p.filters);
        setResult(p.result);
        setRecent(p.recent);
      }
      void loadRecent();
    }, 0);
    return () => clearTimeout(t);
  }, [loadRecent]);

  // 状态变化时持久化到 localStorage（F5 刷新后结果与筛选条件按既定策略保留）
  useEffect(() => {
    savePersisted({ query, source, sort, filters, result, recent });
  }, [query, source, sort, filters, result, recent]);

  const runFind = useCallback(
    async (q: string, src: SourceMode, sortMode: SortMode = sort) => {
      const text = q.trim();
      if (!text) return;
      setBusy(true);
      setError(null);
      setResult(null); // 新的寻找开始：清掉旧结果
      try {
        const res = await fetch("/api/find", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: text, source: src, sort: sortMode }),
        });
        const data = (await res.json()) as {
          error?: string;
          aiNote?: string | null;
          queryUsed?: string;
          repos?: FindRepo[];
          filtered?: boolean;
        };
        if (!res.ok || !data.repos) {
          setError(data.error ?? `查找失败（HTTP ${res.status}）`);
          return;
        }
        setResult({
          aiNote: data.aiNote ?? null,
          queryUsed: data.queryUsed ?? text,
          repos: data.repos,
          filtered: data.filtered ?? false,
        });
        // 服务端已记录该搜索；刷新最近记录
        void loadRecent();
      } catch {
        setError("网络异常，请稍后重试");
      } finally {
        setBusy(false);
      }
    },
    [loadRecent, sort],
  );

  return (
    <Ctx.Provider
      value={{ query, source, sort, filters, result, busy, error, recent, setQuery, setSource, setSort, setFilters, runFind }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useFindStore(): FindStoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFindStore 必须在 <FindProvider> 内使用");
  return v;
}
