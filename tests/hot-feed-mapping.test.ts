// 热榜条目 → FeedItem 映射单测：★总star 度量 + forks 次要 + 中文摘要优先 + 保留 active chip（存量榜语义）。
import { describe, expect, it } from "vitest";
import { hotRepoToFeedItem } from "@/core/analysis/feed";
import type { HotRepo } from "@/core/domain/types";

function repo(over: Partial<HotRepo> & { full_name: string }): HotRepo {
  return {
    rank: 1,
    description: "A cool tool",
    summary: null,
    language: "Rust",
    stars: 42000,
    forks: 3000,
    html_url: `https://github.com/${over.full_name}`,
    topics: ["cli"],
    created_at: "2019-01-01",
    pushed_at: "2026-09-01",
    archived: false,
    license: "MIT",
    ...over,
  };
}

describe("hotRepoToFeedItem", () => {
  const watched = new Set<string>(["github:me/watched"]);

  it("度量=总 star、次要=forks、key 与关注态正确", () => {
    const it1 = hotRepoToFeedItem(repo({ full_name: "me/watched" }), "2026-09-11", watched);
    expect(it1.metric?.label).toBe("★ 42,000");
    expect(it1.secondary).toBe("3,000 forks");
    expect(it1.key).toBe("github:me/watched");
    expect(it1.watched).toBe(true);
    expect(it1.discoveredAt).toBe("2026-09-11");
  });

  it("有中文摘要 → 描述优先取 summary；无 forks → secondary null", () => {
    const it2 = hotRepoToFeedItem(repo({ full_name: "a/b", summary: "很酷的工具", forks: null }), "2026-09-11", new Set());
    expect(it2.description).toBe("很酷的工具");
    expect(it2.secondary).toBeNull();
    expect(it2.watched).toBe(false);
  });

  it("存量榜近期活跃仓库保留「活跃维护」chip（不剔 active，异于新星榜）", () => {
    const it3 = hotRepoToFeedItem(repo({ full_name: "c/d", pushed_at: new Date().toISOString().slice(0, 10) }), "2026-09-11", new Set());
    const kinds = it3.signals?.chips.map((c) => c.kind) ?? [];
    expect(kinds).toContain("active");
  });
});
