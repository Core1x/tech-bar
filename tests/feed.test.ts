// feed 装配纯函数单测：GitHub / HN 映射的正确性（key / sourceId / 度量 / signals 剔除 active / watched 判定）。
// 只测纯映射（不触 I/O）；buildFeed 的 store 读取由运行时 curl 回归覆盖。
import { describe, expect, it } from "vitest";
import { githubRepoToFeedItem, githubTrendingToFeedItem, hnItemToFeedItem } from "@/core/analysis/feed";
import type { NewStarRepo, SourceItem, TrendingRepo } from "@/core/domain/types";

const trending: TrendingRepo = {
  rank: 1,
  full_name: "ayghri/i-have-adhd",
  description: "A skill to stop your coding agent from burying the answer.",
  language: "Python",
  stars: 38509,
  stars_today: 3882,
  forks: 2208,
  html_url: "https://github.com/ayghri/i-have-adhd",
  topics: ["agents", "productivity"],
  created_at: "2025-12-01",
  pushed_at: "2026-09-07",
  archived: false,
  license: "MIT",
};

const repo: NewStarRepo = {
  rank: 1,
  full_name: "deepseek-ai/deepseek-harness",
  description: "Everything is a Plugin.",
  language: "TypeScript",
  stars: 215145,
  created_at: "2026-08-13",
  topics: ["ai", "plugin"],
  html_url: "https://github.com/deepseek-ai/deepseek-harness",
  delta_1d: 513,
  pushed_at: "2026-09-07",
  archived: false,
  license: "MIT",
};

const hn: SourceItem = {
  source: "hackernews",
  source_id: "abc123",
  title: "x",
  url: "https://example.com/x",
  description: null,
  discovered_at: "2026-09-08",
  tags: [],
  metrics: [
    { name: "points", value: 120 },
    { name: "num_comments", value: 45 },
  ],
  _meta: { fetched_at: "2026-09-08" },
};

describe("githubRepoToFeedItem", () => {
  it("映射 key/sourceId/度量/次要/源码标签；active chip 被剔 → signals null", () => {
    const it = githubRepoToFeedItem(repo, "2026-09-08", new Set());
    expect(it.key).toBe("github:deepseek-ai/deepseek-harness");
    expect(it.source).toBe("github");
    expect(it.sourceId).toBe("deepseek-ai/deepseek-harness");
    expect(it.sourceLabel).toBe("GitHub");
    expect(it.title).toBe("deepseek-ai/deepseek-harness");
    expect(it.metric).toEqual({ name: "stars", value: 215145, label: "★ 215,145" });
    expect(it.secondary).toBe("↑513");
    // 仅 active 一个 chip（≤30 天），剔后 signals 应为 null
    expect(it.signals).toBeNull();
    expect(it.watched).toBe(false);
    expect(it.discoveredAt).toBe("2026-09-08");
  });

  it("无 delta → secondary null", () => {
    const it = githubRepoToFeedItem({ ...repo, delta_1d: undefined as unknown as null }, "2026-09-08", new Set());
    expect(it.secondary).toBeNull();
  });

  it("license=null（确无）→ 保留 no-license chip 且不含 active", () => {
    const it = githubRepoToFeedItem({ ...repo, license: null }, "2026-09-08", new Set());
    const kinds = it.signals?.chips.map((c) => c.kind) ?? [];
    expect(kinds).toContain("no-license");
    expect(kinds).not.toContain("active");
    expect(it.signals?.level).toBe("warn");
  });

  it("archived=true → 红「已归档」且不叠维护期判读", () => {
    const it = githubRepoToFeedItem({ ...repo, archived: true }, "2026-09-08", new Set());
    expect(it.signals?.chips.map((c) => c.kind)).toEqual(["archived"]);
    expect(it.signals?.level).toBe("attention");
  });

  it("watchlist 命中 → watched=true", () => {
    const it = githubRepoToFeedItem(repo, "2026-09-08", new Set(["github:deepseek-ai/deepseek-harness"]));
    expect(it.watched).toBe(true);
  });
});

describe("hnItemToFeedItem", () => {
  it("映射 key/sourceId/度量/次要/无 chips；watched=false", () => {
    const it = hnItemToFeedItem(hn, new Set());
    expect(it.key).toBe("hackernews:abc123");
    expect(it.source).toBe("hackernews");
    expect(it.sourceId).toBe("abc123");
    expect(it.metric).toEqual({ name: "points", value: 120, label: "120 pts" });
    expect(it.secondary).toBe("45 评论");
    expect(it.signals).toBeNull(); // 首期无判读 profile
    expect(it.watched).toBe(false);
    expect(it.tags).toEqual([]);
  });

  it("无评论 → secondary null；计入关注态", () => {
    const it = hnItemToFeedItem({ ...hn, metrics: [{ name: "points", value: 0, at: "2026-09-08" }] }, new Set(["hackernews:abc123"]));
    expect(it.secondary).toBeNull();
    expect(it.watched).toBe(true);
  });
});

describe("githubTrendingToFeedItem", () => {
  it("度量=总star、secondary=当日新增；signals 不剔 active（趋势条目年限不限，活跃是真信号）", () => {
    const it = githubTrendingToFeedItem(trending, "2026-09-11", new Set());
    expect(it.key).toBe("github:ayghri/i-have-adhd");
    expect(it.source).toBe("github");
    expect(it.title).toBe("ayghri/i-have-adhd");
    expect(it.metric).toEqual({ name: "stars", value: 38509, label: "★ 38,509" });
    expect(it.secondary).toBe("↑3,882");
    expect(it.tags).toEqual(["agents", "productivity"]);
    // pushed 2026-09-07 距 09-11 4 天 → active chip 保留（与新星榜剔除行为不同）
    expect(it.signals?.chips.map((c) => c.kind)).toContain("active");
  });

  it("未富化（topics/pushed/license 缺省）→ tags 空、signals null（优雅降级）", () => {
    const bare: TrendingRepo = {
      rank: 2,
      full_name: "a/b",
      description: null,
      language: null,
      stars: 100,
      stars_today: 0,
      html_url: "https://github.com/a/b",
    };
    const it = githubTrendingToFeedItem(bare, "2026-09-11", new Set(["github:a/b"]));
    expect(it.tags).toEqual([]);
    expect(it.signals).toBeNull();
    expect(it.secondary).toBeNull(); // stars_today=0 → 无增量文案
    expect(it.description).toBeNull();
    expect(it.watched).toBe(true);
  });
});
