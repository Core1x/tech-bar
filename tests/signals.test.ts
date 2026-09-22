// signals 单测：保守硬旗规则 + 三态语义（undefined=未知不标 / null=确无触发 chip）
import { describe, expect, it } from "vitest";
import { computeSignals } from "@/core/domain/signals";

describe("signals (GitHub profile)", () => {
  const now = new Date("2026-09-07T00:00:00Z");

  it("信号全缺 → level null、无 chips（优雅降级）", () => {
    expect(computeSignals({}, now)).toEqual({ level: null, chips: [], lastPushDays: null });
  });

  it("archived=true → 红「已归档」，且不再叠维护期判读", () => {
    const v = computeSignals({ archived: true, pushed_at: "2020-01-01", license: "MIT" }, now);
    expect(v.level).toBe("attention");
    expect(v.chips.map((c) => c.kind)).toEqual(["archived"]);
  });

  it("license=null（确无）→ 黄「无开源许可证」；license=undefined（未知）不标", () => {
    const noLic = computeSignals({ license: null, pushed_at: "2026-09-01" }, now);
    expect(noLic.chips.map((c) => c.kind)).toContain("no-license");
    const unknown = computeSignals({ license: undefined, pushed_at: "2026-09-01" }, now);
    expect(unknown.chips.map((c) => c.kind)).not.toContain("no-license");
  });

  it("近 30 天活跃 → 绿；>365 天 → 红 stale；180–365 → 黄 slow；31–179 不标", () => {
    expect(computeSignals({ pushed_at: "2026-09-01", license: "MIT" }, now).chips.map((c) => c.kind)).toEqual([
      "active",
    ]);
    expect(computeSignals({ pushed_at: "2025-01-01", license: "MIT" }, now).chips.map((c) => c.kind)).toEqual([
      "stale",
    ]);
    expect(computeSignals({ pushed_at: "2026-03-01", license: "MIT" }, now).chips.map((c) => c.kind)).toEqual([
      "slow",
    ]);
    expect(computeSignals({ pushed_at: "2026-05-15", license: "MIT" }, now).chips).toEqual([]);
  });
});
