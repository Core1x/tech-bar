// canonical 去重归一单测：URL/title 归一 + subject key 生成。
import { describe, expect, it } from "vitest";
import { canonicalSubjectKey, canonicalTitle, canonicalUrlKey } from "@/core/domain/canonical";

describe("canonicalUrlKey", () => {
  it("归一 host 小写、去 query/hash/尾斜杠，github 仓库 → full_name", () => {
    expect(canonicalUrlKey("https://github.com/o/r")).toBe("o/r");
    expect(canonicalUrlKey("https://github.com/o/r/")).toBe("o/r");
    expect(canonicalUrlKey("https://github.com/o/r?tab=readme")).toBe("o/r");
    expect(canonicalUrlKey("https://github.com/o/repo.git")).toBe("o/repo");
    expect(canonicalUrlKey("https://www.github.com/foo/bar")).toBe("foo/bar");
  });

  it("非 github URL：host+path 去 query/hash/尾斜杠，去 www", () => {
    expect(canonicalUrlKey("https://Example.com/a/b?c=1#x")).toBe("example.com/a/b");
    expect(canonicalUrlKey("https://example.com/a/b/")).toBe("example.com/a/b");
    expect(canonicalUrlKey("https://news.ycombinator.com/item?id=1")).toBe("news.ycombinator.com/item");
  });

  it("非法 URL 兜底：小写去空白", () => {
    expect(canonicalUrlKey("not a url")).toBe("not a url");
  });
});

describe("canonicalTitle", () => {
  it("小写、折叠空白、剥离尾部 [..]/(..)/(..) 后缀", () => {
    expect(canonicalTitle("Show HN:   Foo  Bar [video]")).toBe("show hn: foo bar");
    expect(canonicalTitle("Foo Bar (YC S25)")).toBe("foo bar");
    expect(canonicalTitle("OpenAI 新模型（GPT-5 发布）")).toBe("openai 新模型");
  });
});

describe("canonicalSubjectKey", () => {
  it("URL 优先：GitHub html_url 与 HN 外链同 repo → 同 key", () => {
    const github = canonicalSubjectKey({ url: "https://github.com/o/r", title: "o/r" });
    const hn = canonicalSubjectKey({ url: "https://github.com/o/r", title: "some repo" });
    expect(github).toBe("u:o/r");
    expect(hn).toBe("u:o/r");
    expect(github).toBe(hn);
  });

  it("HN 自身 item 页 → 走标题归一（不同标题不同 key）", () => {
    expect(canonicalSubjectKey({ url: "https://news.ycombinator.com/item?id=1", title: "Foo Bar" })).toBe("t:foo bar");
  });

  it("无 URL 无标题 → null（不参与分簇）", () => {
    expect(canonicalSubjectKey({})).toBeNull();
  });
});
