// M0.2 产物新鲜度核心纯函数：指纹、量级分桶、三态判定。
import { describe, expect, it } from "vitest";
import { coarseBucket, fingerprintOf, freshnessOf, type ArtifactMeta } from "@/core/domain/artifact";

function meta(fp: string): ArtifactMeta {
  return {
    schemaVersion: 1,
    kind: "verdict",
    generatedAt: "2026-09-18T09:30:00.000Z",
    sourceDate: "2026-09-18",
    sourceUpdatedAt: "2026-09-18T09:00:00.000Z",
    sourceFingerprint: fp,
  };
}

describe("fingerprintOf", () => {
  it("同输入同指纹；对象键序不同不影响（JSON.stringify 键序=插入序，调用方需保证稳定）", () => {
    expect(fingerprintOf({ a: 1, b: "x" })).toBe(fingerprintOf({ a: 1, b: "x" }));
    expect(fingerprintOf({ a: 1, b: "x" })).not.toBe(fingerprintOf({ b: "x", a: 1 }));
  });
  it("输入任一字段变化即指纹变化（同日数据变更 → stale 的机制根基）", () => {
    expect(fingerprintOf({ license: null })).not.toBe(fingerprintOf({ license: "MIT" }));
    expect(fingerprintOf({ pushed: "2026-09-01" })).not.toBe(fingerprintOf({ pushed: "2026-09-17" }));
  });
  it("长度 12 hex", () => {
    expect(fingerprintOf("anything")).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("coarseBucket（评测引用的约数：量级不变则缓存不过期）", () => {
  it("保留 2 位有效数字", () => {
    expect(coarseBucket(227952)).toBe("230000");
    expect(coarseBucket(1680)).toBe("1700");
    expect(coarseBucket(999)).toBe("1000");
  });
  it("日内小幅漂移同桶、跨量级变桶", () => {
    expect(coarseBucket(227952)).toBe(coarseBucket(228100));
    expect(coarseBucket(227952)).not.toBe(coarseBucket(235000));
  });
  it("个位数保留原值；null/NaN → na；0 → 0", () => {
    expect(coarseBucket(9)).toBe("9");
    expect(coarseBucket(null)).toBe("na");
    expect(coarseBucket(Number.NaN)).toBe("na");
    expect(coarseBucket(0)).toBe("0");
  });
  it("负增量（降温）也可区分", () => {
    expect(coarseBucket(-1680)).toBe("-1700");
  });
});

describe("freshnessOf", () => {
  it("meta 缺失 → legacy（历史缓存 · 依据时间未知）", () => {
    expect(freshnessOf(null, "abc")).toBe("legacy");
    expect(freshnessOf(undefined, "abc")).toBe("legacy");
    expect(freshnessOf({ ...meta("x"), sourceFingerprint: "" }, "abc")).toBe("legacy");
  });
  it("指纹一致 → fresh；不一致 → stale（数据已更新）", () => {
    const m = meta("abc");
    expect(freshnessOf(m, "abc")).toBe("fresh");
    expect(freshnessOf(m, "def")).toBe("stale");
  });
});
