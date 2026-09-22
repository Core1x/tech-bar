// M3 项目决策卡（product-optimization-plan §9.1/§9.2）——纯函数层：
// 结构化输入类型、确定性结论规则、AI 分区文本解析、README 摘要提取、来源指纹。
// 纪律（§3.1 确定性优先）：结论/事实/风险由规则产生；AI 只写四段解释性文字（适合/不适合/现在看/尚无法判断），
// 被要求不引用具体数字、不得从 star 高推导质量或社区支持。零 I/O（domain 层）。
import { createHash } from "node:crypto";
import { coarseBucket, fingerprintOf } from "./artifact";

export type DecisionConclusion = "推荐尝试" | "继续观察" | "谨慎投入" | "仅供参考";

export interface DecisionRelease {
  tag: string;
  publishedAt: string | null;
}

export interface DecisionReadmeDigest {
  /** 是否已读到 README 文本 */
  available: boolean;
  /** README 文本 sha1-12（进入指纹：README 变化 → 决策过期） */
  hash: string | null;
  /** 一级/二级标题（≤8 个，去 # 前缀） */
  headings: string[];
  /** 部署方式/运行环境相关行（对比矩阵与 prompt 用，≤4 条） */
  deploy: string[];
}

export interface DecisionFacts {
  fullName: string;
  description: string | null;
  summary?: string | null;
  language: string | null;
  stars: number;
  forks: number | null;
  openIssues: number | null;
  /** null=确无许可证；licenseKnown=false 时代表未采集（未知≠无） */
  license: string | null;
  licenseKnown: boolean;
  archived: boolean;
  archivedKnown: boolean;
  pushedAt: string | null;
  createdAt: string | null;
  homepage?: string | null;
  topics: string[];
  /** 今日新增 star（自然日口径，数据时间见 poolDate） */
  deltaToday: number | null;
  /** 依据数据时间（今日快照 updated_at；实时拉取=拉取时刻） */
  poolDate: string | null;
  /** 本站趋势采样天数（<3 视为样本不足） */
  trendPoints: number;
  /** 最新 release（可选补充请求；失败/无= null → 进「尚无法判断」） */
  release: DecisionRelease | null;
  readme: DecisionReadmeDigest;
  /** 距上次推送天数（pushedAt 缺省=null） */
  lastPushDays: number | null;
}

/** AI 生成的四段解释（缺失=null，界面显示未生成+入口） */
export interface DecisionSections {
  fit: string | null;
  unfit: string | null;
  whyNow: string | null;
  unknowns: string | null;
}

/**
 * 确定性结论（§9.1 结论枚举）。规则保守、可解释：
 * 归档或超 1 年未推送=仅供参考；未采集到许可=谨慎投入（合规风险明确）；
 * ≤30 天有推送且（今日有增量或采样趋势存在）=推荐尝试；其余活跃仓=继续观察。
 */
export function ruleConclusion(f: Pick<DecisionFacts, "archived" | "archivedKnown" | "license" | "licenseKnown" | "lastPushDays" | "deltaToday" | "trendPoints">): DecisionConclusion {
  if (f.archivedKnown && f.archived) return "仅供参考";
  if (f.lastPushDays !== null && f.lastPushDays > 365) return "仅供参考";
  if (f.licenseKnown && (f.license === null || f.license === "" || f.license === "NOASSERTION")) return "谨慎投入";
  if (f.lastPushDays !== null && f.lastPushDays <= 30 && ((f.deltaToday ?? 0) > 0 || f.trendPoints >= 2)) return "推荐尝试";
  return "继续观察";
}

/** 确定性风险标签（来自事实，不是 AI） */
export function ruleRisks(f: DecisionFacts): string[] {
  const out: string[] = [];
  if (f.archivedKnown && f.archived) out.push("已归档（不再维护）");
  if (f.lastPushDays !== null && f.lastPushDays > 365) out.push(`超 1 年未推送（${f.lastPushDays} 天）`);
  else if (f.lastPushDays !== null && f.lastPushDays >= 180) out.push(`更新放缓（${f.lastPushDays} 天前推送）`);
  if (f.licenseKnown && (f.license === null || f.license === "" || f.license === "NOASSERTION")) out.push("无明确开源许可证（合规风险自担）");
  if (f.trendPoints < 3) out.push(`趋势样本仅 ${f.trendPoints} 天，暂不能判断走势`);
  if (f.release === null) out.push("未获取到正式 release（版本成熟度未知）");
  return out;
}

/** README 摘要：sha1-12 哈希 + 标题清单 + 部署/运行方式相关行（≤4，行内 ≤100 字符） */
export function readmeDigest(text: string | null): DecisionReadmeDigest {
  if (!text || text.trim() === "") return { available: false, hash: null, headings: [], deploy: [] };
  const hash = createHash("sha1").update(text).digest("hex").slice(0, 12);
  const headings: string[] = [];
  const deploy: string[] = [];
  const DEPLOY_RE = /(docker|compose|brew\s+install|apt(-get)?\s+install|npm\s+(i|install|create)\b|pnpm\s+(i|add)\b|yarn\s+add\b|pip[23]?\s+install|uv\s+(pip|add)|cargo\s+install|conda\s+install|go\s+install|systemctl?|releases?\/download|一键安装|快速开始|quick\s*start|getting\s*started|installation|部署|安装)/i;
  for (const line of text.split("\n")) {
    const h = line.match(/^#{1,2}\s+(.+?)\s*#*$/);
    if (h && headings.length < 8) {
      const t = h[1].trim();
      if (t) headings.push(t.slice(0, 40));
    }
    const bare = line.replace(/^[\s>*-]+/, "").trim();
    if (bare && DEPLOY_RE.test(bare) && deploy.length < 4) {
      const snippet = bare.replace(/```.*$/g, "").trim();
      if (snippet) deploy.push(snippet.slice(0, 100));
    }
  }
  return { available: true, hash, headings, deploy };
}

/**
 * 决策来源指纹：进入请求的全部**稳定**事实（描述/许可/维护三态/话题/量级桶/池时间/趋势样本数/README 哈希+部署行）。
 * release 与部署行进 prompt 但不进指纹中 release 部分——「可选补充请求」配额抖动不应假报过期；
 * stars/delta 只取量级桶（正文被要求不引用具体数字）。
 */
export function decisionFingerprint(f: DecisionFacts): string {
  return fingerprintOf({
    fullName: f.fullName,
    desc: f.summary || f.description || "",
    lang: f.language ?? null,
    license: f.licenseKnown ? f.license ?? "none" : "unknown",
    archived: f.archivedKnown ? f.archived : "unknown",
    pushed: f.pushedAt ?? null,
    created: f.createdAt ?? "",
    topics: [...f.topics].sort(),
    starsBucket: coarseBucket(f.stars),
    deltaBucket: coarseBucket(f.deltaToday),
    poolDate: f.poolDate,
    trendPoints: f.trendPoints,
    readmeHash: f.readme.hash,
    deploy: f.readme.deploy,
  });
}

function clean(text: string): string {
  return text.trim().replace(/^["“「']+|["”」']+$/g, "").replace(/[。;；]\s*$/, "").slice(0, 160);
}

const SECTION_KEYS: Record<string, keyof DecisionSections> = {
  适合: "fit",
  适合场景: "fit",
  不适合: "unfit",
  不适合场景: "unfit",
  现在: "whyNow",
  为什么现在值得看: "whyNow",
  未知: "unknowns",
  尚无法判断: "unknowns",
};

/**
 * 白名单解析 AI 分区文本（同 /api/similar 纯文本纪律，绝不 JSON.parse）：
 * 每行 `段名 || 文本`（适合|不适合|现在|未知，容忍全角冒号/竖线变体）；未知段名/表头行忽略；
 * 同段多次出现用「；」拼接（≤2 次）。返回缺失=null。
 */
export function parseDecisionSections(raw: string): DecisionSections {
  const parts: Record<keyof DecisionSections, string[]> = { fit: [], unfit: [], whyNow: [], unknowns: [] };
  for (const line of raw.split("\n")) {
    const cleaned = line.trim().replace(/^[-*•\d.)、\s]+/, "");
    const m = cleaned.match(/^(适合场景|不适合场景|为什么现在值得看|尚无法判断|适合|不适合|现在|未知)\s*(?:[|｜:：]+)\s*(.*)$/);
    if (!m) continue;
    const key = SECTION_KEYS[m[1]];
    if (!key) continue;
    const text = clean(m[2]);
    if (text) parts[key].push(text);
  }
  const join = (arr: string[]) => (arr.length > 0 ? arr.slice(0, 2).join("；") : null);
  return { fit: join(parts.fit), unfit: join(parts.unfit), whyNow: join(parts.whyNow), unknowns: join(parts.unknowns) };
}
