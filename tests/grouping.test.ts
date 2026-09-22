// 跨源去重/串联单测：URL 命中聚簇、保守规则（≥2 不同源才成组）、无关不组。
import { describe, expect, it } from "vitest";
import { applyGrouping, groupFeedItems } from "@/core/analysis/grouping";
import type { FeedItem } from "@/core/domain/types";

function item(source: string, sourceId: string, title: string, url: string): FeedItem {
  return {
    key: `${source}:${sourceId}`,
    source,
    sourceId,
    sourceLabel: source === "github" ? "GitHub" : "Hacker News",
    title,
    url,
    description: null,
    tags: [],
    metric: null,
    signals: null,
    discoveredAt: "2026-09-08",
    watched: false,
  };
}

describe("groupFeedItems", () => {
  it("GitHub 仓 ↔ HN 外链同 github URL → 成组、共享同一 groupId", () => {
    const gh = item("github", "o/r", "o/r", "https://github.com/o/r");
    const hn = item("hackernews", "hn1", "some project", "https://github.com/o/r");
    const { assignments, groups } = groupFeedItems([gh, hn]);
    expect(groups.size).toBe(1);
    const gid = assignments.get("github:o/r")!;
    expect(gid).toBeTruthy();
    expect(assignments.get("hackernews:hn1")).toBe(gid);
    expect(groups.get(gid)).toHaveLength(2);
  });

  it("同一 canonical key 但仅单源 → 不成组（保守，避免同名误并）", () => {
    // 两个 GitHub 条目，标题都归一为同一（单源内 full_name 本应唯一，仅当异常重复时不并）
    const a = item("github", "o/r", "o/r", "https://github.com/o/r");
    const b = item("github", "o/r2", "o/r", "https://github.com/o/r");
    const { assignments, groups } = groupFeedItems([a, b]);
    expect(groups.size).toBe(0);
    expect(assignments.size).toBe(0);
  });

  it("无关条目（不同 URL/标题）→ 不组", () => {
    const a = item("github", "a/1", "a/1", "https://github.com/a/1");
    const b = item("hackernews", "hn2", "totally different", "https://example.com/other");
    const { groups } = groupFeedItems([a, b]);
    expect(groups.size).toBe(0);
  });

  it("applyGrouping 给成组条目写 groupId、未成组保留 null", () => {
    const gh = item("github", "o/r", "o/r", "https://github.com/o/r");
    const hn = item("hackernews", "hn1", "some project", "https://github.com/o/r");
    const lone = item("hackernews", "hn9", "x", "https://example.com/x");
    const { assignments } = groupFeedItems([gh, hn, lone]);
    const out = applyGrouping([gh, hn, lone], assignments);
    expect(out[0].groupId).toBeTruthy();
    expect(out[1].groupId).toBe(out[0].groupId);
    expect(out[2].groupId).toBeUndefined();
  });
});
