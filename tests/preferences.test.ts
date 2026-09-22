// M5 §11.3 兴趣偏好清洗与「为什么匹配」解释的补充回归：sanitize 边界 + find-explain 多字段组合。
import { describe, expect, it } from "vitest";
import { sanitizePreferences } from "@/core/config/preferences";
import { explainRepoMatch, queryTermsOf } from "@/core/domain/find-explain";

describe("sanitizePreferences", () => {
  it("非数组/非法项静默丢弃；bias 枚举外回 neutral；限长去重", () => {
    const p = sanitizePreferences({
      languages: ["  Rust ", "RUST", 42, "x".repeat(80)],
      topics: "not-an-array",
      negativeTopics: null,
      bias: "weird",
    });
    // 大小写归一去重；非字符串与超长项（>40）整体丢弃
    expect(p.languages).toEqual(["rust"]);
    expect(p.topics).toEqual([]);
    expect(p.negativeTopics).toEqual([]);
    expect(p.bias).toBe("neutral");
  });
  it("合法输入规范化（小写、bias 保留）", () => {
    const p = sanitizePreferences({ languages: ["TS"], topics: ["LLM", "agent"], negativeTopics: ["game"], bias: "new" });
    expect(p).toEqual({ languages: ["ts"], topics: ["llm", "agent"], negativeTopics: ["game"], bias: "new" });
  });
});

describe("find-explain 组合", () => {
  it("queryTermsOf 提取限定符与中文短语", () => {
    const terms = queryTermsOf("rust 终端", "language:rust topic:terminal-emulator pdf");
    expect(terms).toContain("rust");
    expect(terms).toContain("terminal-emulator");
    expect(terms).toContain("pdf");
    expect(terms.some((t) => t.includes("终端"))).toBe(true);
  });
  it("话题/描述/语言/多路组合解释，≤3 条且按证据强度排序", () => {
    const why = explainRepoMatch(
      { full_name: "owner/pdf", description: "Converts PDF into markdown", topics: ["pdf", "markdown"], language: "Rust" },
      queryTermsOf("pdf", "markdown 转换", "rust"),
      3,
    );
    expect(why[0]).toContain("话题命中");
    expect(why.length).toBe(3); // 强证据占满 3 条时，弱证据（多路命中）让位
    // 单话题命中时多路证据能挤进第 2 条
    const why2 = explainRepoMatch({ full_name: "a/b", description: "", topics: ["pdf"], language: null }, ["pdf", "markdown"], 3);
    expect(why2).toEqual(["话题命中「pdf」", "被 3 路查询同时命中"]);
  });
  it("字段全不命中给透明兜底而不是编造", () => {
    const why = explainRepoMatch({ full_name: "a/b", description: "x", topics: [], language: null }, queryTermsOf("zzznope"), 1);
    expect(why).toEqual(["关键词搜索命中（未匹配到具体字段）"]);
  });
});
