// M3 纯函数：项目决策结论规则、AI 分区解析、README 摘要、来源指纹、同类候选质量门槛。
import { describe, expect, it } from "vitest";
import {
  decisionFingerprint,
  parseDecisionSections,
  readmeDigest,
  ruleConclusion,
  type DecisionFacts,
} from "@/core/domain/decision";
import { similarCandidateDisqualifies } from "@/core/domain/hot-filter";

function facts(over: Partial<DecisionFacts> = {}): DecisionFacts {
  return {
    fullName: "a/b",
    description: "一个工具",
    language: "Rust",
    stars: 1000,
    forks: 10,
    openIssues: 5,
    license: "MIT",
    licenseKnown: true,
    archived: false,
    archivedKnown: true,
    pushedAt: "2026-09-15",
    createdAt: "2024-01-01",
    topics: ["rust"],
    deltaToday: 100,
    poolDate: "2026-09-18T09:00:00+08:00",
    trendPoints: 10,
    release: { tag: "v1.2.3", publishedAt: "2026-09-01" },
    readme: { available: true, hash: "abc", headings: ["安装", "使用"], deploy: [] },
    lastPushDays: 3,
    ...over,
  };
}

describe("ruleConclusion（确定性结论）", () => {
  it("归档或超一年未推送 → 仅供参考", () => {
    expect(ruleConclusion(facts({ archived: true }))).toBe("仅供参考");
    expect(ruleConclusion(facts({ lastPushDays: 400 }))).toBe("仅供参考");
  });
  it("确无明确许可 → 谨慎投入；许可未知不冤枉", () => {
    expect(ruleConclusion(facts({ license: null }))).toBe("谨慎投入");
    expect(ruleConclusion(facts({ license: "NOASSERTION" }))).toBe("谨慎投入");
    expect(ruleConclusion(facts({ licenseKnown: false, license: null }))).not.toBe("谨慎投入");
  });
  it("活跃且有当日增量 → 推荐尝试；无增量老仓 → 继续观察", () => {
    expect(ruleConclusion(facts())).toBe("推荐尝试");
    expect(ruleConclusion(facts({ deltaToday: 0, trendPoints: 0 }))).toBe("继续观察");
  });
});

describe("parseDecisionSections（分区文本白名单解析）", () => {
  const raw = [
    "适合 || 需要边缘设备上的本地推理",
    "不适合 || 需要多模态或托管 SaaS 的场景",
    "为什么现在值得看 || 近期活跃且刚发布稳定版",
    "一些前言",
    "尚无法判断 || 代码质量与社区响应速度",
  ].join("\n");
  it("识别四段全名/短名，忽略表头杂行", () => {
    const s = parseDecisionSections(raw);
    expect(s.fit).toBe("需要边缘设备上的本地推理");
    expect(s.unfit).toBe("需要多模态或托管 SaaS 的场景");
    expect(s.whyNow).toBe("近期活跃且刚发布稳定版");
    expect(s.unknowns).toBe("代码质量与社区响应速度");
  });
  it("短名 + 全角冒号也可；缺失段=null", () => {
    const s = parseDecisionSections("适合：本地推理场景");
    expect(s.fit).toBe("本地推理场景");
    expect(s.unfit).toBeNull();
    expect(s.whyNow).toBeNull();
  });
  it("同段多次用「；」拼接且 ≤2 次", () => {
    const s = parseDecisionSections("适合 || 一\n适合 || 二\n适合 || 三");
    expect(s.fit).toBe("一；二");
  });
});

describe("readmeDigest（哈希 + 标题 + 部署行）", () => {
  const md = [
    "# My Tool",
    "介绍文字",
    "## Installation",
    "```bash",
    "npm install my-tool",
    "```",
    "## Usage",
    "运行 `my-tool serve` 即可（Docker 方式见 releases/download）",
    "### 附录",
  ].join("\n");
  it("空/无 → 不可用且无哈希", () => {
    expect(readmeDigest(null)).toEqual({ available: false, hash: null, headings: [], deploy: [] });
    expect(readmeDigest("   ")).toEqual({ available: false, hash: null, headings: [], deploy: [] });
  });
  it("同文本同哈希、改动即变", () => {
    expect(readmeDigest(md).hash).toBe(readmeDigest(md).hash);
    expect(readmeDigest(md + "\nx").hash).not.toBe(readmeDigest(md).hash);
  });
  it("提取一级/二级标题（### 不计）与部署线索行（≤4）", () => {
    const d = readmeDigest(md);
    expect(d.headings).toEqual(["My Tool", "Installation", "Usage"]);
    expect(d.deploy.some((x) => x.includes("npm install"))).toBe(true);
    expect(d.deploy.some((x) => x.toLowerCase().includes("releases/download"))).toBe(true);
    expect(d.deploy.length).toBeLessThanOrEqual(4);
  });
});

describe("decisionFingerprint（来源版本稳定性）", () => {
  it("同事实同指纹；描述/许可/README/池时间变化即变", () => {
    expect(decisionFingerprint(facts())).toBe(decisionFingerprint(facts()));
    expect(decisionFingerprint(facts({ description: "变了" }))).not.toBe(decisionFingerprint(facts()));
    expect(decisionFingerprint(facts({ license: null }))).not.toBe(decisionFingerprint(facts()));
    expect(decisionFingerprint(facts({ readme: { ...facts().readme, hash: "zzz" } }))).not.toBe(decisionFingerprint(facts()));
    expect(decisionFingerprint(facts({ poolDate: "2026-09-19T09:00:00+08:00" }))).not.toBe(decisionFingerprint(facts()));
  });
  it("release 不进指纹（可选补充请求的抖动不假报过期）", () => {
    expect(decisionFingerprint(facts({ release: null }))).toBe(decisionFingerprint(facts()));
  });
  it("star 只取量级桶（2 位有效数字）：同桶漂移不改指纹，跨桶改", () => {
    expect(decisionFingerprint(facts({ stars: 1001 }))).toBe(decisionFingerprint(facts({ stars: 1049 })));
    expect(decisionFingerprint(facts({ stars: 1100 }))).not.toBe(decisionFingerprint(facts({ stars: 1049 })));
  });
});

describe("similarCandidateDisqualifies（§9.6 宁缺勿凑）", () => {
  it("归档/无 star/信息缺失出圈，合格返回 null", () => {
    expect(similarCandidateDisqualifies({ archived: true, stars: 5000, description: "x", topics: ["t"] })).toBe("已归档");
    expect(similarCandidateDisqualifies({ stars: 0, description: "x" })).toBe("无 star");
    expect(similarCandidateDisqualifies({ stars: 9, description: "", topics: [] })).toBe("信息缺失");
    expect(similarCandidateDisqualifies({ stars: 9, description: "有描述", topics: [] })).toBeNull();
    expect(similarCandidateDisqualifies({ stars: 9, summary: "摘要有", topics: [] })).toBeNull();
  });
});
