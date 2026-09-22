// 按需生成当日洞察：供 /api/digest 路由调用。
// M2 起为 digest 生成唯一实现（web /api/digest 与 cli/daily 共用；原 daily.mjs 零依赖复制已删除），
// 因此 token 用量会计入侧边栏统计；幂等：文件已存在则不重复生成。
// M4（§10.2）：写产物时带 `.md.meta.json` sidecar（来源版本：生成时间/数据覆盖时间/来源指纹/模型）；
//   指纹=实际喂入的「新星 Top20 + 追踪池增量 Top10」文本块（不是只取日期）；旧产物缺 sidecar=legacy。
import fs from "fs/promises";
import path from "path";
import { DIGESTS_DIR, listDigests, readLatest } from "./data";
import { completeChat, hasDeepSeekKey } from "./deepseek";
import { resolveAiConfig } from "./ai-config";
import { buildNewStarsBlock, deltaTopTracked } from "./prompt-blocks";
import { fingerprintOf, type ArtifactMeta } from "@/core/domain/artifact";
import { readArtifactMeta, writeArtifact } from "@/core/store/artifact";

const pad = (n: number) => String(n).padStart(2, "0");

/** 本地日期 YYYY-MM-DD */
export function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function generateTodayDigest(
  dateStr: string,
  opts: { force?: boolean } = {},
): Promise<{ created: boolean; file: string; content: string }> {
  const file = path.join(DIGESTS_DIR, `${dateStr}.md`);
  // 幂等：已存在则跳过（M4：force=true 为「数据已更新，重新生成」入口，覆盖旧正文与 meta）
  if (!opts.force) {
    try {
      const existing = await fs.readFile(file, "utf-8");
      return { created: false, file, content: existing };
    } catch {
      // 不存在，继续生成
    }
  }

  const latest = await readLatest();
  if (!latest) {
    throw Object.assign(new Error("尚无榜单数据，请先点击顶栏「刷新趋势数据」生成"), { status: 400 });
  }
  if (!(await hasDeepSeekKey())) {
    throw Object.assign(new Error("未配置 AI 接入，请先到「设置」页填写"), { status: 503 });
  }

  const newStarsText = buildNewStarsBlock(latest.new_stars, 20);
  const deltaText = deltaTopTracked(latest.tracked, 10)
    .map((r) => `- ${r.full_name}｜今日 +${r.delta_1d ?? 0} star｜总 ${r.stars}`)
    .join("\n");
  const recentTitles = (await listDigests())
    .filter((d) => d.date < dateStr)
    .slice(0, 3)
    .map((d) => `- ${d.title}`)
    .join("\n");
  // 来源指纹：只哈希「进入请求的数据块」（近期标题是措辞护栏，不算数据输入）
  const fingerprint = fingerprintOf({ newStarsText, deltaText });

  const prompt = `你是 GitHub 开源趋势分析师。请基于以下今日真实数据，写一篇 800-1200 字的中文 Markdown 趋势分析文章。
要求：
- 首行用一级标题（# ${dateStr} 开源趋势洞察）
- 结构包含：新星亮点 / 语言与领域动向 / 值得关注的项目
- 只基于提供的数据，不要编造 star 数或项目信息
- 输出纯 Markdown 正文，不要用代码围栏包裹

## 今日新星榜（Top 20）
${newStarsText}

## 追踪池近日新增 star Top 10
${deltaText}

## 近 3 天洞察标题（避免完全重复，可呼应延续）
${recentTitles || "（无）"}`;

  const content = await completeChat([{ role: "user", content: prompt }], {
    // 800-1200 字长文在本机网关（~15-25 tok/s）常超 120s；放宽到 240s（原 09:00 定时同口径）
    signal: AbortSignal.timeout(240_000),
    reasoningEffort: "low",
    maxTokens: 4000,
  });
  const meta: ArtifactMeta = {
    schemaVersion: 1,
    kind: "digest",
    generatedAt: new Date().toISOString(),
    sourceDate: dateStr,
    sourceUpdatedAt: latest.updated_at,
    sourceFingerprint: fingerprint,
    model: (await resolveAiConfig()).model,
  };
  await writeArtifact(file, content.trim() + "\n", meta);
  return { created: true, file, content };
}

/** 洞察产物的来源元数据（无 sidecar 的旧产物 → null=legacy） */
export async function readDigestMeta(dateStr: string): Promise<ArtifactMeta | null> {
  return readArtifactMeta(path.join(DIGESTS_DIR, `${dateStr}.md`));
}

/** 当日洞察是否仍基于当前最新数据：重建喂入块并比对指纹（无当日数据 → null） */
export async function digestFingerprintToday(): Promise<string | null> {
  const latest = await readLatest();
  if (!latest) return null;
  const newStarsText = buildNewStarsBlock(latest.new_stars, 20);
  const deltaText = deltaTopTracked(latest.tracked, 10)
    .map((r) => `- ${r.full_name}｜今日 +${r.delta_1d ?? 0} star｜总 ${r.stars}`)
    .join("\n");
  return fingerprintOf({ newStarsText, deltaText });
}
