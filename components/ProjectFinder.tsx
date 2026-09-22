// /find 页的客户端交互（M5 §11.1 升级）：自然语言 → POST /api/find → 结果 + 字段级「为什么匹配」；
// 新增：首次进入可点击示例（不留大面积空区）、结果筛选（语言/最低star/更新时间/许可证/归档，即时过滤不重发请求）、
// 搜索条件摘要 + 一键清除、结果行 关注/加入对比 动作、最后推送与许可证展示。
// 「非开源」统一改口径为「无明确许可证」（公开仓库无许可证不等于私有项目）。
// 状态来自全局 FindStore：切页/刷新后结果与筛选按既定策略保留。
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LangDot } from "@/components/LangDot";
import { VerdictChips } from "@/components/VerdictChips";
import { CompareButton } from "@/components/CompareButton";
import { postWatchToggle } from "@/components/watchApi";
import {
  useFindStore,
  isDefaultFilters,
  passFilter,
  type FindFilters,
  type FindRepo,
  type SourceMode,
  type SortMode,
} from "@/components/FindStore";
import { formatStarsCompact } from "@/lib/format";

// §11.1 建议示例（点即搜）
const EXAMPLES = ["本地部署大模型", "React 数据可视化", "自托管团队知识库", "PDF 转 Markdown", "Rust 桌面应用"];

const LICENSE_OPTIONS: Array<{ value: SourceMode; label: string; title: string }> = [
  { value: "all", label: "不限许可证", title: "不区分许可证状态" },
  { value: "open", label: "许可证明确", title: "仅带有效开源许可证（SPDX）的仓库" },
  { value: "closed", label: "无明确许可证", title: "公开但未声明/无法识别开源许可证的仓库（并非私有项目）" },
];

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "popularity", label: "按人气" },
  { value: "relevance", label: "按相关度" },
];

const PUSHED_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null, label: "更新时间不限" },
  { value: 30, label: "30 天内有推送" },
  { value: 90, label: "90 天内有推送" },
  { value: 365, label: "1 年内有推送" },
];

const LICENSE_FILTER_OPTIONS: Array<{ value: FindFilters["license"]; label: string }> = [
  { value: "any", label: "许可证不限" },
  { value: "yes", label: "仅明确" },
  { value: "no", label: "仅无明确" },
];

function FilterSelect<T extends string | number | null>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
}) {
  return (
    <select
      value={String(value)}
      disabled={disabled}
      onChange={(e) => {
        const hit = options.find((o) => String(o.value) === e.target.value);
        if (hit) onChange(hit.value);
      }}
      className="rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-sm text-[#e6edf3] outline-none transition-colors focus:border-[#58a6ff] disabled:opacity-60"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ProjectFinder({ hasKey = true }: { hasKey?: boolean }) {
  const searchParams = useSearchParams();
  const { query, source, sort, filters, result, busy, error, recent, setQuery, setSource, setSort, setFilters, runFind } =
    useFindStore();
  const autoSearched = useRef(false);
  // 关注态（全站 watchlist 的 keys）；行内☆按钮切换
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [watchPending, setWatchPending] = useState<Set<string>>(new Set());

  // 挂载时若带 ?q= 参数则自动搜索一次（StrictMode 双挂载：ref 判断放回调里）
  useEffect(() => {
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/watchlist");
          const j = (await res.json()) as { keys?: string[] };
          if (Array.isArray(j.keys)) setWatched(new Set(j.keys));
        } catch {
          // 未加载到关注态不影响搜索功能
        }
      })();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const q = searchParams.get("q")?.trim();
    if (!q) return;
    const t = setTimeout(() => {
      if (autoSearched.current) return;
      autoSearched.current = true;
      setQuery(q);
      void runFind(q, "all", "popularity");
    }, 0);
    return () => clearTimeout(t);
    // 仅在挂载时读取一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 结果行关注切换（乐观 + 回滚），快照信息随请求附带（M2）
  async function toggleWatch(repo: FindRepo) {
    const key = `github:${repo.full_name}`;
    if (watchPending.has(repo.full_name)) return;
    const cur = watched.has(key);
    setWatched((s) => {
      const n = new Set(s);
      if (cur) n.delete(key);
      else n.add(key);
      return n;
    });
    setWatchPending((s) => new Set(s).add(repo.full_name));
    try {
      const res = await postWatchToggle({
        source: "github",
        sourceId: repo.full_name,
        title: repo.full_name,
        url: repo.html_url,
        metricLabel: `★ ${formatStarsCompact(repo.stars)}`,
      });
      const j = (await res.json()) as { ok?: boolean; watched?: boolean; error?: string };
      if (!j.ok) toggleRollback(key);
    } catch {
      toggleRollback(key);
    } finally {
      setWatchPending((s) => {
        const n = new Set(s);
        n.delete(repo.full_name);
        return n;
      });
    }
  }
  function toggleRollback(key: string) {
    setWatched((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  const visible = useMemo(() => (result ? result.repos.filter((r) => passFilter(r, filters)) : []), [result, filters]);
  // 语言选项从当前结果动态收集（只列出现过的语言，按仓库数降序）
  const languageOptions = useMemo(() => {
    if (!result) return [];
    const count = new Map<string, number>();
    for (const r of result.repos) if (r.language) count.set(r.language, (count.get(r.language) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([lang, n]) => ({ value: lang, label: `语言 ${lang}（${n}）` }));
  }, [result]);

  const filtersActive = !isDefaultFilters(filters);
  const patchFilters = (p: Partial<FindFilters>) => setFilters({ ...filters, ...p });

  // 从未搜索且无结果 → 示例区（§11.1：首次进入不留大面积空区域）
  const showExamples = !result && !busy && !query.trim();

  return (
    <section className="mt-6 space-y-6">
      {/* 搜索卡片 */}
      <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={2}
          placeholder="例如：用 Rust 写的高性能终端模拟器、团队协作的 AI 代理工作台、把 PDF 转成 Markdown 的工具…"
          disabled={busy}
          className="w-full resize-none rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3] placeholder-[#8b949e] outline-none transition-colors focus:border-[#58a6ff] disabled:opacity-60"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] p-0.5">
            {LICENSE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSource(opt.value)}
                disabled={busy}
                title={opt.title}
                className={`rounded px-3 py-1 text-sm transition-colors disabled:opacity-60 ${
                  source === opt.value ? "bg-[#21262d] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] p-0.5">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSort(opt.value)}
                disabled={busy}
                title={opt.value === "popularity" ? "星标越多越靠前" : "匹配度越高越靠前"}
                className={`rounded px-3 py-1 text-sm transition-colors disabled:opacity-60 ${
                  sort === opt.value ? "bg-[#21262d] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => runFind(query, source, sort)}
            disabled={busy || !query.trim()}
            className="rounded-md bg-[#238636] px-5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#2ea043] disabled:opacity-50"
          >
            {busy ? "AI 寻找中…" : "AI 寻找"}
          </button>
        </div>

        <p className="mt-2 text-xs text-[#8b949e]">
          「无明确许可证」= 公开仓库但未声明/无法识别开源许可证（并非私有项目；GitHub 检索仅覆盖公开仓库）
        </p>
        {!hasKey && (
          <p className="mt-1 text-xs text-[#d29922]">
            未配置 AI 接入：将用「中英同义表 + 关键词」搜索（仍可用），配置 AI Key 后能更懂你的自然语言需求。
            <Link href="/settings" className="ml-1 text-[#58a6ff] hover:underline">
              去「设置」填写
            </Link>
          </p>
        )}
      </div>

      {/* 首次进入：可点击示例需求直接搜索（不留大面积空区） */}
      {showExamples && (
        <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4">
          <p className="mb-2 text-xs font-semibold text-[#8b949e]">试试这些需求（点击直接搜索）</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => {
                  setQuery(ex);
                  void runFind(ex, source, sort);
                }}
                className="rounded-full border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-sm text-[#58a6ff] transition-colors hover:border-[#58a6ff] hover:text-[#e6edf3]"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 最近搜索：点击可一键复搜（命中缓存不重复消耗 token） */}
      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#8b949e]">
          <span className="text-[#8b949e]">最近搜索：</span>
          {recent.map((r) => (
            <button
              key={`${r.query}-${r.source}-${r.sort ?? "popularity"}`}
              onClick={() => {
                setQuery(r.query);
                void runFind(r.query, r.source, r.sort ?? "popularity");
              }}
              disabled={busy}
              className="max-w-[220px] truncate rounded-full border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-[#58a6ff] transition-colors hover:border-[#58a6ff] hover:text-[#e6edf3] disabled:opacity-50"
              title={`${r.source === "open" ? "许可证明确" : r.source === "closed" ? "无明确许可证" : "不限"} · ${r.sort === "relevance" ? "按相关度" : "按人气"} · ${r.query}`}
            >
              {r.query}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[#f85149]/40 bg-[#f85149]/10 px-3 py-2 text-sm text-[#f85149]">
          {error}
        </div>
      )}

      {busy && (
        <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-8 text-center text-sm text-[#8b949e]">
          <span className="animate-pulse">AI 正在理解需求并检索 GitHub…</span>
        </div>
      )}

      {result && !busy && (
        <div className="space-y-6">
          {/* AI 推荐 */}
          {result.aiNote && (
            <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4">
              <p className="mb-2 text-xs font-semibold text-[#58a6ff]">AI 推荐</p>
              <div className="markdown-body text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.aiNote}</ReactMarkdown>
              </div>
            </div>
          )}

          {/* 结果列表 */}
          <div>
            <h2 className="mb-1 text-lg font-semibold text-[#e6edf3]">
              找到 {result.repos.length} 个仓库
              {visible.length !== result.repos.length ? (
                <span className="ml-2 text-sm font-normal text-[#58a6ff]">筛选后 {visible.length} 个</span>
              ) : null}
              <span className="ml-2 text-sm font-normal text-[#8b949e]">搜索词：{result.queryUsed}</span>
            </h2>

            {/* 搜索条件摘要（§11.1）：查询 + 许可证模式 + 筛选条件，可一键清除 */}
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="rounded-full bg-[#21262d] px-2 py-0.5 text-[#8b949e]" title="AI 寻找使用中英文多路查询并集去重">
                条件：查询「{query || result.queryUsed}」 · {LICENSE_OPTIONS.find((o) => o.value === source)?.label} · {sort === "relevance" ? "按相关度" : "按人气"}
              </span>
              {filters.language && <span className="rounded-full bg-[#21262d] px-2 py-0.5 text-[#8b949e]">语言 {filters.language}</span>}
              {filters.minStars > 0 && <span className="rounded-full bg-[#21262d] px-2 py-0.5 text-[#8b949e]">≥ {formatStarsCompact(filters.minStars)} ★</span>}
              {filters.pushedWithinDays && <span className="rounded-full bg-[#21262d] px-2 py-0.5 text-[#8b949e]">{filters.pushedWithinDays} 天内有推送</span>}
              {filters.license !== "any" && (
                <span className="rounded-full bg-[#21262d] px-2 py-0.5 text-[#8b949e]">许可证{filters.license === "yes" ? "明确" : "无明确"}</span>
              )}
              {filters.hideArchived && <span className="rounded-full bg-[#21262d] px-2 py-0.5 text-[#8b949e]">隐藏归档</span>}
              {(filtersActive || query) && (
                <button
                  onClick={() => {
                    setFilters({ language: null, minStars: 0, pushedWithinDays: null, license: "any", hideArchived: false });
                    setQuery("");
                  }}
                  className="text-[#58a6ff] underline-offset-2 hover:underline"
                >
                  一键清除
                </button>
              )}
            </div>

            {/* 筛选栏（结果就绪后出现；即时过滤不重发请求） */}
            {result.repos.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2">
                <FilterSelect
                  value={filters.language ?? ""}
                  onChange={(v) => patchFilters({ language: v || null })}
                  options={[{ value: "", label: "语言不限" }, ...languageOptions]}
                  disabled={busy}
                />
                <label className="flex items-center gap-1.5 text-xs text-[#8b949e]">
                  最低 star
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={filters.minStars || ""}
                    placeholder="0"
                    onChange={(e) => patchFilters({ minStars: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-24 rounded-md border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm text-[#e6edf3] outline-none focus:border-[#58a6ff]"
                  />
                </label>
                <FilterSelect
                  value={filters.pushedWithinDays as string | number | null}
                  onChange={(v) => patchFilters({ pushedWithinDays: v === null || typeof v === "number" ? v : Number(v) })}
                  options={PUSHED_OPTIONS.map((o) => ({ value: o.value as string | number | null, label: o.label }))}
                  disabled={busy}
                />
                <FilterSelect value={filters.license} onChange={(v) => patchFilters({ license: v })} options={LICENSE_FILTER_OPTIONS} disabled={busy} />
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[#8b949e]">
                  <input
                    type="checkbox"
                    checked={filters.hideArchived}
                    onChange={(e) => patchFilters({ hideArchived: e.target.checked })}
                    className="h-3.5 w-3.5 accent-[#58a6ff]"
                  />
                  隐藏归档
                </label>
                {filtersActive && (
                  <button
                    onClick={() => setFilters({ language: null, minStars: 0, pushedWithinDays: null, license: "any", hideArchived: false })}
                    className="text-xs text-[#58a6ff] underline-offset-2 hover:underline"
                  >
                    清除筛选
                  </button>
                )}
              </div>
            )}

            {result.repos.length === 0 ? (
              <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-8 text-center text-sm text-[#8b949e]">
                {result.filtered
                  ? "没有找到合适的匹配项目（部分候选经安全判定被排除），换个描述试试"
                  : "没有匹配的项目，试试换一个更宽泛的描述"}
              </div>
            ) : visible.length === 0 ? (
              <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-8 text-center text-sm text-[#8b949e]">
                {result.repos.length} 个结果都被当前筛选条件过滤掉了。
                <button
                  onClick={() => setFilters({ language: null, minStars: 0, pushedWithinDays: null, license: "any", hideArchived: false })}
                  className="ml-1 text-[#58a6ff] underline"
                >
                  清除筛选
                </button>
              </div>
            ) : (
              <ul className="space-y-3">
                {visible.map((repo) => {
                  const wKey = `github:${repo.full_name}`;
                  const isWatched = watched.has(wKey);
                  return (
                    <li key={repo.full_name} className="rounded-lg border border-[#30363d] bg-[#161b22] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <button
                              type="button"
                              onClick={() => toggleWatch(repo)}
                              disabled={watchPending.has(repo.full_name)}
                              title={isWatched ? "取消关注" : "加入关注"}
                              aria-label={isWatched ? "取消关注" : "加入关注"}
                              className={
                                "flex h-6 w-6 shrink-0 items-center justify-center rounded border text-xs transition-colors " +
                                (isWatched
                                  ? "border-[#e3b341]/50 bg-[#e3b341]/15 text-[#e3b341]"
                                  : "border-[#30363d] text-[#8b949e] hover:border-[#8b949e]")
                              }
                            >
                              {isWatched ? "★" : "☆"}
                            </button>
                            <Link
                              href={`/repo/${repo.full_name}`}
                              className="break-all font-medium text-[#58a6ff] hover:underline"
                            >
                              {repo.full_name}
                            </Link>
                            {repo.language && (
                              <span className="flex items-center gap-1 text-xs text-[#8b949e]">
                                <LangDot language={repo.language} />
                                {repo.language}
                              </span>
                            )}
                            <span className="text-xs text-[#8b949e]">★ {formatStarsCompact(repo.stars)}</span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-xs ${
                                repo.license
                                  ? "border-[#3fb950]/40 text-[#3fb950]"
                                  : "border-[#d29922]/40 text-[#d29922]"
                              }`}
                            >
                              {repo.license ? `许可证 ${repo.license}` : "无明确许可证"}
                            </span>
                          </div>
                          {repo.description && (
                            <p className="mt-1.5 line-clamp-2 text-sm text-[#8b949e]">{repo.description}</p>
                          )}
                          {repo.topics.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {repo.topics.slice(0, 6).map((t) => (
                                <span
                                  key={t}
                                  className="rounded-full border border-[#30363d] bg-[#0d1117] px-2 py-0.5 text-xs text-[#58a6ff]"
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                          {/* 判读条（维护/归档信号；许可证状态行头已有 pill，去重） */}
                          <VerdictChips repo={repo} hideKinds={["no-license"]} className="mt-2" />
                          {/* 为什么匹配（字段级、确定性）+ 最后推送 */}
                          {repo.why && repo.why.length > 0 && (
                            <p className="mt-2 text-xs text-[#8b949e]">
                              <span className="mr-1 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 text-[10px] text-[#8b949e]">
                                为什么匹配
                              </span>
                              {repo.why.join("；")}
                            </p>
                          )}
                          <p className="mt-1 text-[11px] text-[#8b949e]">
                            最后推送：{repo.pushed_at ?? "未采集"}
                            {repo.archived === true ? <span className="ml-2 text-[#f85149]">已归档</span> : null}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <a
                            href={repo.html_url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="shrink-0 text-[#8b949e] transition-colors hover:text-[#58a6ff]"
                            aria-label={`${repo.full_name} GitHub 外链`}
                          >
                            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden>
                              <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm8.054-.28a.75.75 0 0 1 .476.216l.03.029a.75.75 0 0 1 .19.515v.01l-.001 4.5a.75.75 0 0 1-1.5 0V4.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06l3.22-3.22H9.75a.75.75 0 0 1 0-1.5h1.82a.75.75 0 0 1 .234.03Z" />
                            </svg>
                          </a>
                          <CompareButton fullName={repo.full_name} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
