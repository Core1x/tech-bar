// M1「异常变化」纯函数：关注加减速、归档翻牌、许可变化、源过期（§7.4 只报真正需要注意的）。
import { describe, expect, it } from "vitest";
import { detectAnomalies, detectSourceStaleness, type AnomalyInput } from "@/core/analysis/anomalies";
import type { FeedSectionResult } from "@/core/analysis/feed";

function baseInput(over: Partial<AnomalyInput> = {}): AnomalyInput {
  return {
    watchGithub: new Set<string>(),
    today: new Map(),
    yesterday: null,
    todayDelta: new Map(),
    avgDelta7: new Map(),
    ...over,
  };
}

describe("detectAnomalies", () => {
  it("昨日活跃 → 今日归档：报归档变化", () => {
    const out = detectAnomalies(
      baseInput({
        today: new Map([["a/b", { full_name: "a/b", stars: 100, archived: true, license: "MIT" }]]),
        yesterday: new Map([["a/b", { full_name: "a/b", stars: 99, archived: false, license: "MIT" }]]),
      }),
    );
    expect(out.some((a) => a.kind === "archived" && a.ref === "a/b")).toBe(true);
  });

  it("许可 明确→缺失 / 变更 都报；NOASSERTION 视作缺失不重复报", () => {
    const lost = detectAnomalies(
      baseInput({
        today: new Map([["a/b", { full_name: "a/b", stars: 1, license: null }]]),
        yesterday: new Map([["a/b", { full_name: "a/b", stars: 1, license: "Apache-2.0" }]]),
      }),
    );
    expect(lost.some((a) => a.kind === "license" && a.text.includes("不再可查"))).toBe(true);
    const changed = detectAnomalies(
      baseInput({
        today: new Map([["a/b", { full_name: "a/b", stars: 1, license: "MIT" }]]),
        yesterday: new Map([["a/b", { full_name: "a/b", stars: 1, license: "GPL-3.0" }]]),
      }),
    );
    expect(changed.some((a) => a.kind === "license" && a.text.includes("GPL-3.0 → MIT"))).toBe(true);
    const naToNull = detectAnomalies(
      baseInput({
        today: new Map([["a/b", { full_name: "a/b", stars: 1, license: null }]]),
        yesterday: new Map([["a/b", { full_name: "a/b", stars: 1, license: "NOASSERTION" }]]),
      }),
    );
    expect(naToNull.filter((a) => a.kind === "license")).toHaveLength(0);
  });

  it("加速/降温只判关注项目、需日均样本与基数达标", () => {
    const accel = detectAnomalies(
      baseInput({
        watchGithub: new Set(["you/watched"]),
        today: new Map([["you/watched", { full_name: "you/watched", stars: 900 }]]),
        yesterday: new Map([["you/watched", { full_name: "you/watched", stars: 800 }]]),
        todayDelta: new Map([["you/watched", 300]]),
        avgDelta7: new Map([["you/watched", 60]]),
      }),
    );
    expect(accel.some((a) => a.kind === "accelerate")).toBe(true);
    const cool = detectAnomalies(
      baseInput({
        watchGithub: new Set(["you/watched"]),
        today: new Map([["you/watched", { full_name: "you/watched", stars: 810 }]]),
        yesterday: new Map([["you/watched", { full_name: "you/watched", stars: 800 }]]),
        todayDelta: new Map([["you/watched", 5]]),
        avgDelta7: new Map([["you/watched", 80]]),
      }),
    );
    expect(cool.some((a) => a.kind === "cool")).toBe(true);
    // 未关注 / 基数太小 / 无昨日样本 都不报
    const none = detectAnomalies(
      baseInput({
        watchGithub: new Set(),
        today: new Map([["you/watched", { full_name: "you/watched", stars: 900 }]]),
        yesterday: new Map([["you/watched", { full_name: "you/watched", stars: 800 }]]),
        todayDelta: new Map([["you/watched", 500]]),
        avgDelta7: new Map([["you/watched", 10]]),
      }),
    );
    expect(none.filter((a) => a.kind === "accelerate" || a.kind === "cool")).toHaveLength(0);
  });

  it("冷启动（无昨日快照）不凭空报状态变化", () => {
    const out = detectAnomalies(
      baseInput({ today: new Map([["a/b", { full_name: "a/b", stars: 1, archived: true }]]) }),
    );
    expect(out).toHaveLength(0);
  });
});

describe("detectSourceStaleness", () => {
  const sec = (id: string, fetchedAt: string | null): FeedSectionResult => ({
    id, title: id, sourceLabel: id, items: [], fetchedAt, count: 0,
  });
  it("启用但无板块=取数失败；非今日=未更新至今日；今日=不报", () => {
    const out = detectSourceStaleness(
      [sec("github", "2026-09-18T09:00:00+08:00"), sec("cnblogs", "2026-09-16T09:00:00+08:00")],
      ["github", "juejin", "cnblogs"],
      "2026-09-18",
    );
    expect(out.some((a) => a.ref === "juejin" && a.kind === "source-stale")).toBe(true);
    expect(out.some((a) => a.ref === "cnblogs" && a.text.includes("2026-09-16"))).toBe(true);
    expect(out.filter((a) => a.ref === "github")).toHaveLength(0);
  });
});
