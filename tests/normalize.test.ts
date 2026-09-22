// HN normalize 纯函数单测
import { describe, expect, it } from "vitest";
import { hnItemUrl, normalizeHn, type HnHit } from "@/core/sources/hackernews/normalize";

const hit: HnHit = {
  objectID: "abc123",
  title: "Writing a tiny OS in Rust",
  url: "https://example.com/os",
  points: 120,
  num_comments: 45,
  author: "author1",
  created_at: "2026-09-08T02:00:00.000Z",
};

describe("hn normalize", () => {
  it("映射关键字段：source_id/url/metrics/无 tags", () => {
    const [item] = normalizeHn([hit], "2026-09-08");
    expect(item.source).toBe("hackernews");
    expect(item.source_id).toBe("abc123");
    expect(item.title).toBe("Writing a tiny OS in Rust");
    expect(item.url).toBe("https://example.com/os");
    expect(item.tags).toEqual([]);
    expect(item.discovered_at).toBe("2026-09-08");
    expect(item.metrics).toEqual([
      { name: "points", value: 120 },
      { name: "num_comments", value: 45 },
    ]);
  });

  it("无外链时 url 回退 HN item 页", () => {
    const [item] = normalizeHn([{ ...hit, url: null }], "2026-09-08");
    expect(item.url).toBe(hnItemUrl("abc123"));
  });

  it("无 title 时用 story_text/占位，并按 points 降序排", () => {
    const items = normalizeHn(
      [
        { objectID: "a", title: "low", url: "x", points: 5, num_comments: 0 },
        { objectID: "b", story_text: "story only", url: "y", points: 100, num_comments: 3 },
        { objectID: "c", title: null, story_text: null, url: "z", points: 0, num_comments: 0 },
      ],
      "2026-09-08",
    );
    expect(items.map((i) => i.source_id)).toEqual(["b", "a", "c"]);
    expect(items[1].title).toBe("low");
    expect(items[2].title).toBe("(untitled)");
  });
});
