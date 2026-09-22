// feed-text 源中立文本块单测：只带源标识 + 各源原生度量，绝不假合并。
import { describe, expect, it } from "vitest";
import { buildFeedTextBlock, feedItemToText, type FeedTextSection } from "@/core/domain/feed-text";
import type { FeedItem } from "@/core/domain/types";

const githubItem: FeedItem = {
  key: "github:o/r",
  source: "github",
  sourceId: "o/r",
  sourceLabel: "GitHub",
  title: "o/r",
  url: "https://github.com/o/r",
  description: "a plugin framework",
  tags: ["plugin", "ai"],
  metric: { name: "stars", value: 215145, label: "★ 215,145" },
  secondary: "↑513",
  signals: null,
  discoveredAt: "2026-09-08",
  watched: false,
};

const hnItem: FeedItem = {
  key: "hackernews:abc",
  source: "hackernews",
  sourceId: "abc",
  sourceLabel: "Hacker News",
  title: "Foo Bar",
  url: "https://example.com/foo",
  description: null,
  tags: [],
  metric: { name: "points", value: 120, label: "120 pts" },
  secondary: "45 评论",
  signals: null,
  discoveredAt: "2026-09-08",
  watched: false,
};

describe("feedItemToText", () => {
  it("GitHub 条目带源标识与其原生度量（★/delta/tags/描述）", () => {
    const t = feedItemToText(githubItem);
    expect(t).toContain("[GitHub]");
    expect(t).toContain("o/r");
    expect(t).toContain("★ 215,145");
    expect(t).toContain("↑513");
    expect(t).toContain("tags plugin/ai");
    expect(t).toContain("a plugin framework");
  });

  it("HN 条目带 points/评论数，不出现 star", () => {
    const t = feedItemToText(hnItem);
    expect(t).toContain("[Hacker News]");
    expect(t).toContain("120 pts");
    expect(t).toContain("45 评论");
    expect(t).not.toContain("star");
  });

  it("无 secondary/tags/描述时不残留空段", () => {
    const t = feedItemToText({ ...hnItem, secondary: null, tags: [], description: null });
    expect(t).toBe("- [Hacker News] Foo Bar｜120 pts");
  });
});

describe("buildFeedTextBlock", () => {
  it("按源分块、逐源计条数、保留各自度量，两份块都出现", () => {
    const sections: FeedTextSection[] = [
      { sourceLabel: "GitHub", items: [githubItem] },
      { sourceLabel: "Hacker News", items: [hnItem] },
    ];
    const block = buildFeedTextBlock(sections);
    expect(block).toContain("【GitHub · 今日1 条】");
    expect(block).toContain("【Hacker News · 今日1 条】");
    expect(block).toContain("★ 215,145");
    expect(block).toContain("120 pts");
    // 不假合并：不把 star 与 pts 放进同一行/同一排序
    expect(block).not.toMatch(/★.+pts/);
  });
});
