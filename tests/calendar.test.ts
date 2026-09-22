// calendar 纯函数单测：自然周口径 + 缺口容忍 diff（权威实现在 core/domain/calendar.ts，见 M1.2 头注）
import { describe, expect, it } from "vitest";
import { addDays, dateMinusDays, diffDays, lastSunday, mondayOf, parseDate } from "@/core/domain/calendar";

describe("calendar", () => {
  it("自然周边界：周一 09-07 与周日 09-13 属同一自然周；09-02(周三)属上周（周一 08-31）", () => {
    expect(mondayOf("2026-09-07")).toBe("2026-09-07");
    expect(mondayOf("2026-09-13")).toBe("2026-09-07");
    expect(mondayOf("2026-09-02")).toBe("2026-08-31");
  });

  it("lastSunday: 周一(2026-09-14)的上一个已完成周日是 09-13", () => {
    expect(lastSunday("2026-09-14")).toBe("2026-09-13");
  });

  it("lastSunday: 周日当天返回上周日（周一才出上周报）", () => {
    expect(lastSunday("2026-09-13")).toBe("2026-09-06");
  });

  it("dateMinusDays/addDays 对称且跨月正确", () => {
    expect(dateMinusDays("2026-09-01", 1)).toBe("2026-08-31");
    expect(addDays("2026-09-01", 1)).toBe("2026-09-02");
    expect(addDays(dateMinusDays("2026-09-01", 7), 7)).toBe("2026-09-01");
  });

  it("diffDays: 实数差值（快照缺口不假定连续）", () => {
    expect(diffDays("2026-09-01", "2026-09-10")).toBe(9);
  });

  it("parseDate 按 UTC 零点解析（避开时区漂移）", () => {
    const d = new Date(parseDate("2026-09-07"));
    expect(d.toISOString().slice(0, 10)).toBe("2026-09-07");
  });
});
