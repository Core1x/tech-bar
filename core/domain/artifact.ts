// M0.2 AI 产物来源版本与过期状态（product-optimization-plan §6）——统一元数据结构与新鲜度规则。
// 承载策略：Markdown 产物用同名 `.meta.json` sidecar（主文件内容不变，对既有读取零影响）；
// JSON 产物（similar）内嵌 meta 字段。旧产物缺元数据一律按 legacy 读取，重新生成后自然升级。
// 纯函数、零 I/O（domain 层）；文件读写在 core/store/artifact.ts。
import { createHash } from "node:crypto";

export interface ArtifactMeta {
  schemaVersion: 1;
  kind: "cross-digest" | "digest" | "weekly" | "verdict" | "review" | "similar" | "decision" | "briefing";
  /** AI 内容生成时间（ISO） */
  generatedAt: string;
  /** 依据数据所属的自然日 */
  sourceDate: string;
  /** 依据数据的抓取/更新时间（ISO；无法确定时为 null） */
  sourceUpdatedAt: string | null;
  /** 由实际进入该 AI 请求的数据计算的指纹（不是日期，见 freshnessOf） */
  sourceFingerprint: string;
  model?: string | null;
}

/** 产物相对「当前输入」的新鲜度：未生成/生成中/失败由调用方状态机表达，这里只有命中后的三态 */
export type ArtifactFreshness = "fresh" | "stale" | "legacy";

/** AI 请求输入指纹：对任意结构化输入取 sha1 前 12 位 hex（与 verdict/similar 既有缓存文件名指纹同口径） */
export function fingerprintOf(input: unknown): string {
  return createHash("sha1").update(JSON.stringify(input)).digest("hex").slice(0, 12);
}

/**
 * 粗粒度分桶（保留 2 位有效数字，如 227952 → "230000"、1680 → "1700"）。
 * 正文引用了具体 star/增量的产物（评测），这些字段必须进入指纹；分桶使「量级未变的小幅漂移」
 * 不至于让缓存每天过期，量级变化则准确判 stale。
 */
export function coarseBucket(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "na";
  if (n === 0) return "0";
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(n))) - 1);
  if (mag < 1) return String(n);
  return String(Math.round(n / mag) * mag);
}

/** 新鲜度判定：meta 缺失（或结构非法）→ legacy；指纹与当前输入不一致 → stale；一致 → fresh */
export function freshnessOf(
  meta: ArtifactMeta | null | undefined,
  currentFingerprint: string,
): ArtifactFreshness {
  if (!meta || typeof meta.sourceFingerprint !== "string" || !meta.sourceFingerprint) return "legacy";
  return meta.sourceFingerprint === currentFingerprint ? "fresh" : "stale";
}
