// M1「今日必须看」纯函数：确定性选择打分与上限、模板理由、AI 推荐语白名单解析。
import { describe, expect, it } from "vitest";
import { parsePolish, selectBriefingItems, type BriefingRawItem } from "@/core/analysis/briefing";

function gh(name: string, over: Partial<BriefingRawItem> = {}): BriefingRawItem {
  return {
    key: `github:${name}`,
    source: "github",
    sourceLabel: "GitHub",
    title: name,
    rank: 99,
    sourceCount: 20,
    watched: false,
    groupCount: 1,
    otherSourceLabels: [],
    newToSite: false,
    stars: 10000,
    delta: 100,
    relGrowth: null,
    redFlags: [],
    amberFlags: [],
    metricLabel: "★ 10,000",
    ...over,
  };
}

function article(source: string, label: string, title: string, rank: number, count = 20, over: Partial<BriefingRawItem> = {}): BriefingRawItem {
  return {
    key: `${source}:${rank}`,
    source,
    sourceLabel: label,
    title,
    rank,
    sourceCount: count,
    watched: false,
    groupCount: 1,
    otherSourceLabels: [],
    newToSite: false,
    redFlags: [],
    amberFlags: [],
    metricLabel: `${1000 - rank * 10} 赞`,
    ...over,
  };
}

describe("selectBriefingItems", () => {
  it("GitHub 当日增量为主导信号：增量最大者优先", () => {
    const out = selectBriefingItems([gh("big", { delta: 5000, rank: 1 }), gh("small", { delta: 100, rank: 5 })]);
    expect(out[0].item.key).toBe("github:big");
    expect(out[0].evidence.some((e) => e.includes("+5,000") && e.includes("趋势榜第 1"))).toBe(true);
  });

  it("相对增幅≥10% 加成并给出证据", () => {
    const out = selectBriefingItems([gh("surging", { delta: 800, relGrowth: 0.6 })]);
    expect(out[0].evidence.some((e) => e.includes("相对增幅 +60%"))).toBe(true);
    const plain = selectBriefingItems([gh("steady", { delta: 800 })]);
    expect(plain[0].score).toBeLessThan(out[0].score);
  });

  it("同主题跨源与新入视野出证据；关注只加权（关系不是依据）", () => {
    const both = selectBriefingItems([
      gh("x", { delta: 500, groupCount: 2, otherSourceLabels: ["掘金"], newToSite: true, watched: true }),
    ]);
    const ev = both[0].evidence;
    expect(ev.some((e) => e.includes("同主题跨 2 个信息源出现（掘金）"))).toBe(true);
    expect(ev.some((e) => e.includes("今日首次被本站发现"))).toBe(true);
    expect(ev.some((e) => e.includes("关注"))).toBe(false);
    const unwatched = selectBriefingItems([
      gh("x", { delta: 500, groupCount: 2, otherSourceLabels: ["掘金"], newToSite: true, watched: false }),
    ]);
    expect(both[0].score).toBeGreaterThan(unwatched[0].score);
  });

  it("单源最多 3 条、总量最多 5 条（弱信号不硬凑）", () => {
    const many = Array.from({ length: 8 }, (_, i) => gh(`r${i}`, { delta: 1000 - i, rank: i + 1 }));
    const withArticles = [...many, article("juejin", "掘金", "a", 1), article("cnblogs", "博客园", "b", 1)];
    const out = selectBriefingItems(withArticles);
    expect(out.length).toBeLessThanOrEqual(5);
    const ghCount = out.filter((c) => c.item.source === "github").length;
    expect(ghCount).toBeLessThanOrEqual(3);
    // 文章源 top 榜位应能入选（不被 GitHub 全占）
    expect(out.some((c) => c.item.source === "juejin")).toBe(true);
  });

  it("归档重罚出局；无许可只挂标签", () => {
    const out = selectBriefingItems([gh("dead", { delta: 9000, rank: 1, archived: true, redFlags: ["已归档"] }), gh("alive", { delta: 5000, rank: 2 })]);
    expect(out.map((c) => c.item.key)).not.toContain("github:dead");
    expect(out.map((c) => c.item.key)).toContain("github:alive");
    const lic = selectBriefingItems([gh("nolic", { delta: 500, noLicense: true, amberFlags: ["无开源许可证"] })]);
    expect(lic[0].risk.some((r) => r.label === "无开源许可证" && r.tone === "amber")).toBe(true);
  });

  it("模板理由=前两条依据拼接（无 AI 可展示的确定性降级）", () => {
    const out = selectBriefingItems([gh("n", { delta: 2000, groupCount: 2, otherSourceLabels: ["掘金"] })]);
    expect(out[0].templateReason).toContain("今日新增 star +2,000");
    expect(out[0].templateReason).toContain("同主题跨 2 个信息源出现（掘金）");
  });

  it("M5 兴趣偏好只改排序不改存在性：命中加权、负面沉底、bias 生效", () => {
    const base = [
      gh("hot", { delta: 4000, rank: 1 }),
      gh("pref-hit", { delta: 3000, rank: 2, prefLang: true, language: "Rust", prefTopicHits: ["llm"] }),
      gh("hated", { delta: 4000, rank: 3, prefNegativeHits: ["game"] }),
    ];
    const neutral = selectBriefingItems(
      base.map((c) => ({ ...c, prefLang: false, prefTopicHits: [], prefNegativeHits: [], prefBias: "neutral" as const })),
    );
    const withPrefs = selectBriefingItems(base);
    const orderOf = (arr: typeof neutral) => arr.map((c) => c.item.key).join(",");
    expect(orderOf(withPrefs)).not.toBe(orderOf(neutral));
    // 命中偏好的条目排在同数据、无命中的 hot 之前（+主题10+语言8 足以在增量相近时反超）
    expect(orderOf(withPrefs).indexOf("github:pref-hit")).toBeLessThan(orderOf(withPrefs).indexOf("github:hot"));
    // 负面主题重罚：hated 沉底但不删除
    expect(orderOf(withPrefs).endsWith("github:hated")).toBe(true);
    expect(withPrefs.length).toBe(3);
    // bias=new 给新入视野额外加权
    const a = selectBriefingItems([gh("n", { delta: 200, newToSite: true })])[0].score;
    const b = selectBriefingItems([gh("n", { delta: 200, newToSite: true, prefBias: "new" })])[0].score;
    expect(b).toBeGreaterThan(a);
    // 偏好命中主题进证据（可核实）
    const ev = withPrefs.find((c) => c.item.key === "github:pref-hit")!.evidence;
    expect(ev.some((e) => e.includes("匹配你的关注主题「llm」"))).toBe(true);
  });
  it("证据条数 ≤3", () => {
    const out = selectBriefingItems([gh("all", { delta: 5000, relGrowth: 0.5, newToSite: true, watched: true, groupCount: 3, otherSourceLabels: ["掘金", "博客园"] })]);
    expect(out[0].evidence.length).toBeLessThanOrEqual(3);
  });
});

describe("parsePolish（白名单行解析，绝不 JSON.parse 模型输出）", () => {
  const known = new Set(["github:a/b", "juejin:1"]);
  it("认 key || 理由 行；容忍序号与引号；丢弃未知 key 与表头", () => {
    const raw = [
      "输出如下：",
      "1. github:a/b || 榜单热度与跨源串联齐备",
      '2. key=juejin:1 ||  「社区讨论集中」',
      "3. unknown:x || 编造的",
      "没有分隔符的一行",
    ].join("\n");
    const m = parsePolish(raw, known);
    expect(m.get("github:a/b")).toBe("榜单热度与跨源串联齐备");
    expect(m.get("juejin:1")).toBe("社区讨论集中");
    expect(m.has("unknown:x")).toBe(false);
  });
  it("全角分隔符与裸竖线同样可解析（网关模型常把 || 写成 ｜）", () => {
    const m = parsePolish("github:a/b｜理由一\njuejin:1|理由二", known);
    expect(m.get("github:a/b")).toBe("理由一");
    expect(m.get("juejin:1")).toBe("理由二");
  });
  it("无 key 裸理由：行数与候选严格相等才按序对齐，否则不采用", () => {
    const keys = ["github:a/b", "juejin:1"];
    const known = new Set(keys);
    const aligned = parsePolish("热度飙升值得看\n社区讨论集中", known, keys);
    expect(aligned.get("github:a/b")).toBe("热度飙升值得看");
    expect(aligned.get("juejin:1")).toBe("社区讨论集中");
    const shifted = parsePolish("多了一行\n热度飙升值得看\n社区讨论集中", known, keys);
    expect(shifted.size).toBe(0); // 计数不符 → 宁可全部回落模板，绝不错位张冠李戴
  });
  it("keyed 命中时不混入按序对齐（部分缺失回落模板）", () => {
    const keys = ["github:a/b", "juejin:1"];
    const m = parsePolish("github:a/b || 有 key 的行\n随便一句", new Set(keys), keys);
    expect(m.get("github:a/b")).toBe("有 key 的行");
    expect(m.has("juejin:1")).toBe(false);
  });
  it("空理由丢弃；重复 key 保第一条", () => {
    const empty = parsePolish("juejin:1 ||\njuejin:1 ||   ", known);
    expect(empty.has("juejin:1")).toBe(false);
    const dup = parsePolish("github:a/b || 一\ngithub:a/b || 二", known);
    expect(dup.get("github:a/b")).toBe("一");
  });
});
