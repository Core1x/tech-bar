// 新星榜 Tab（客户端组件）：总榜 + **自适应语言 Tab** + AI 主题 Tab。
// 语言 Tab 按当日榜单实际出现的语言动态生成（条数降序；语言过多时归「其他」），
// 因此 Java/C++/Go/HTML 等一出现就自动有对应 Tab，无需维护固定清单。
"use client";
import { useMemo, useState } from "react";
import type { NewStarRepo } from "@/lib/types";
import { RepoRow } from "./RepoRow";

/** 语言 Tab 上限（超出并入「其他」），避免 Tab 栏过长 */
const MAX_LANGS = 8;
const OTHER_KEY = "__other__";
const ALL_KEY = "__all__";
const AI_KEY = "__ai__";

/** AI 判定：topics 或描述命中 ai/llm/agent/gpt/clip 等关键词（主题 Tab，非语言） */
const AI_KEYWORDS = /\b(ai|llm|agent|agents|gpt|clip|diffusion|multimodal|language model|machine learning|deep learning|neural)\b/i;

interface Tab {
  key: string;
  label: string;
  match: (repo: NewStarRepo) => boolean;
}

const matchAi = (repo: NewStarRepo): boolean =>
  AI_KEYWORDS.test(`${repo.topics.join(" ")} ${repo.description ?? ""}`);

export function TrendingTabs({ repos }: { repos: NewStarRepo[] }) {
  const [active, setActive] = useState<string>(ALL_KEY);

  // 自适应语言 Tab：按当日语言条数降序；超过 MAX_LANGS 的余量归「其他」
  const langTabs = useMemo<Tab[]>(() => {
    const count = new Map<string, number>();
    for (const r of repos) if (r.language) count.set(r.language, (count.get(r.language) ?? 0) + 1);
    const sorted = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const top = sorted.slice(0, MAX_LANGS);
    const rest = new Set(sorted.slice(MAX_LANGS).map(([l]) => l));
    const tabs: Tab[] = top.map(([lang]) => ({
      key: `lang:${lang}`,
      label: lang,
      match: (r) => r.language === lang,
    }));
    if (rest.size > 0) {
      tabs.push({ key: OTHER_KEY, label: "其他", match: (r) => !!r.language && rest.has(r.language) });
    }
    return tabs;
  }, [repos]);

  const tabs = useMemo<Tab[]>(
    () => [
      { key: ALL_KEY, label: "总榜", match: () => true },
      ...langTabs,
      { key: AI_KEY, label: "AI", match: matchAi },
    ],
    [langTabs],
  );

  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];
  const filtered = useMemo(() => repos.filter(activeTab.match), [repos, activeTab]);

  return (
    <div className="rounded-lg border border-[#30363d] bg-[#0d1117]">
      {/* Tab 栏 */}
      <div className="hscroll-thin flex gap-1 overflow-x-auto border-b border-[#21262d] px-3 pt-2">
        {tabs.map((tab) => {
          const count = repos.filter(tab.match).length;
          const isActive = tab.key === activeTab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActive(tab.key)}
              className={`-mb-px shrink-0 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "border-[#f78166] text-[#e6edf3]"
                  : "border-transparent text-[#8b949e] hover:border-[#8b949e] hover:text-[#e6edf3]"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-xs text-[#8b949e]">{count}</span>
            </button>
          );
        })}
      </div>

      {/* 榜单 */}
      <div>
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[#8b949e]">该分类下暂无上榜项目</p>
        ) : (
          filtered.map((repo) => <RepoRow key={repo.full_name} repo={repo} />)
        )}
      </div>
    </div>
  );
}
