// 热榜过滤纯函数单测：技术性硬排除各分支 + 装配（类内去重/排序/多类目共存/出榜去重）。
// 关键回归点：**无任何关键词审查**——描述含敏感向文字也照常入榜（该规则已按需求整体移除）；
// 以及"长期未维护"不在此层排除（由 computeSignals 的红 chip 承担）。
import { describe, expect, it } from "vitest";
import {
  hardExcludeReason,
  excludeReasonFor,
  assembleHotSections,
  type HotAssembleCategory,
  type HotFilterInput,
} from "@/core/domain/hot-filter";

function item(over: Partial<HotFilterInput> & { full_name: string }): HotFilterInput {
  return { description: "desc", topics: [], stars: 10000, ...over };
}

describe("hardExcludeReason", () => {
  it("归档/Fork/无描述/无README/star不足 → 各出中文原因；正常 → null", () => {
    expect(hardExcludeReason(item({ full_name: "a/b", archived: true }), 5000)).toBe("已归档");
    expect(hardExcludeReason(item({ full_name: "a/b", fork: true }), 5000)).toBe("Fork 仓库");
    expect(hardExcludeReason(item({ full_name: "a/b", description: "  " }), 5000)).toBe("无描述");
    expect(hardExcludeReason(item({ full_name: "a/b", readme: "n" }), 5000)).toBe("无 README");
    expect(hardExcludeReason(item({ full_name: "a/b", stars: 4999 }), 5000)).toContain("star 低于门槛");
    expect(hardExcludeReason(item({ full_name: "a/b" }), 5000)).toBeNull();
  });

  it("README 未知（缺省/y）→ 保留；star 门槛取边界等号（>=floor 通过）", () => {
    expect(hardExcludeReason(item({ full_name: "a/b", readme: "y" }), 5000)).toBeNull();
    expect(hardExcludeReason(item({ full_name: "a/b", stars: 5000 }), 5000)).toBeNull();
    expect(hardExcludeReason(item({ full_name: "a/b" }), 5000)).toBeNull(); // readme 缺省=未知，不因此排除
  });

  it("优先级：已归档 先于 star 不足（同一条只记第一个原因）", () => {
    expect(hardExcludeReason(item({ full_name: "a/b", archived: true, stars: 1 }), 5000)).toBe("已归档");
  });
});

describe("excludeReasonFor（仅技术性）", () => {
  it("描述含政治向词汇 → 不再被过滤（关键词审查规则已移除）", () => {
    expect(excludeReasonFor(item({ full_name: "someone/political-thing", description: "某某独立运动相关" }), 5000)).toBeNull();
  });
});

function cat(over: Partial<HotAssembleCategory> & { id: string; label: string }): HotAssembleCategory {
  return { starFloor: 5000, items: [], ...over };
}
function full(over: Partial<HotAssembleCategory["items"][number]> & { full_name: string; stars: number }) {
  return {
    description: "d",
    topics: [],
    language: null,
    html_url: `https://github.com/${over.full_name}`,
    created_at: "2020-01-01",
    pushed_at: "2026-01-01",
    ...over,
  } as HotAssembleCategory["items"][number];
}

describe("assembleHotSections", () => {
  it("类内跨查询按 full_name 去重（先出现者保留）+ 按总 star 降序", () => {
    const res = assembleHotSections([
      cat({
        id: "x",
        label: "X",
        items: [full({ full_name: "a/small", stars: 6000 }), full({ full_name: "b/big", stars: 90000 }), full({ full_name: "a/small", stars: 6001 })],
      }),
    ]);
    expect(res.categories[0].items.map((i) => i.full_name)).toEqual(["b/big", "a/small"]);
    expect(res.filtered).toHaveLength(0);
  });

  it("多类目共存：同仓在两类目都达标 → 两处都入榜、无出榜", () => {
    const shared = full({ full_name: "core/repo", stars: 50000 });
    const res = assembleHotSections([
      cat({ id: "p", label: "P", items: [shared] }),
      cat({ id: "q", label: "Q", items: [shared] }),
    ]);
    expect(res.categories[0].items).toHaveLength(1);
    expect(res.categories[1].items).toHaveLength(1);
    expect(res.filtered).toHaveLength(0);
  });

  it("出榜记录仓库级去重：同仓在多类目都不达标 → 只出榜一条、categories 记全", () => {
    const junk = (n: string) => full({ full_name: n, stars: 10 }); // 低于门槛
    const res = assembleHotSections([
      cat({ id: "p", label: "P", items: [junk("dup/one")] }),
      cat({ id: "q", label: "Q", items: [junk("dup/one")] }),
    ]);
    expect(res.filtered).toHaveLength(1);
    expect(res.filtered[0].full_name).toBe("dup/one");
    expect(res.filtered[0].reason).toContain("star 低于门槛");
    expect(res.filtered[0].categories.sort()).toEqual(["p", "q"]);
  });

  it("长期未维护（pushed_at 很久以前）不在本层排除（红 chip 由 signals 承担）", () => {
    const stale = full({ full_name: "old/repo", stars: 8000, pushed_at: "2010-01-01" });
    const res = assembleHotSections([cat({ id: "p", label: "P", items: [stale] })]);
    expect(res.categories[0].items.map((i) => i.full_name)).toEqual(["old/repo"]);
    expect(res.filtered).toHaveLength(0);
  });
});
