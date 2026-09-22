// schedule 纯函数单测：到期判定 + due 过滤 + lastRuns 折叠
import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS, dueSources, foldLastRuns, isDue } from "@/core/pipeline/schedule";
import type { SourceRunResult } from "@/core/sources/adapter";

describe("schedule", () => {
  const now = Date.UTC(2026, 8, 7, 12, 0, 0); // 2026-09-07 12:00 UTC

  it("isDue: 从未跑过必跑；距今 ≥ cadence 到期；不足未到期", () => {
    expect(isDue(now, null, DAY_MS)).toBe(true);
    expect(isDue(now, now - DAY_MS, DAY_MS)).toBe(true);
    expect(isDue(now, now - DAY_MS + 1, DAY_MS)).toBe(false); // 还差 1ms
  });

  it("dueSources: 只返回到期源；未登记 cadence 的源不自动跑", () => {
    const lastRuns: Record<string, number | null> = {
      github: now - DAY_MS, // 刚好到期
      hackernews: now, // 刚跑过
    };
    const due = dueSources(
      [
        { sourceId: "github", cadenceMs: DAY_MS },
        { sourceId: "hackernews", cadenceMs: 6 * HOUR_MS },
        { sourceId: "arxiv", cadenceMs: DAY_MS },
      ],
      lastRuns,
      now,
    );
    expect(due).toEqual(["github", "arxiv"]); // arxiv 未登记 lastRun → null → due
  });

  it("foldLastRuns: 成功跑的更新 lastRun；skipped/失败不更新", () => {
    const results: SourceRunResult[] = [
      { sourceId: "github", ok: true },
      { sourceId: "hackernews", ok: false, message: "boom" },
      { sourceId: "arxiv", ok: true, skipped: true },
    ];
    const folded = foldLastRuns({ hackernews: 111 }, results, now);
    expect(folded.github).toBe(now);
    expect(folded.hackernews).toBe(111); // 失败：保留旧值
    expect(folded.arxiv).toBeUndefined(); // skipped：不写入
  });
});
