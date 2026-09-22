// 跨源 AI 综述（Phase 5 的 A + C 每日部分）——「今日跨源值得看」的单一生成器。
// 数据源 = buildFeed()（只读各源今日已落库快照）。拼「源中立文本块」（feed-text）喂模型，
// 遵守整合不混比：各源自排序、度量保留，绝不跨源假合并。产物 = data/cross-digests/{date}.md，
// 供首页 FeedSummary（peek 探测 + 点按/定时触发）与 cli/daily 定时共用——一份产物、两种展示面。
// 幂等：文件在则跳过（force=true 覆盖重生成——M0.2「重新生成」按钮的语义）；无 key 抛 503；无数据抛 400。
// M0.2：写产物时一并写 `.meta.json` sidecar（来源指纹=实际喂入模型的文本块）；
// 同日数据刷新后指纹漂移 → readCrossDigestMeta+crossDigestFreshness 判 stale，界面提示可重新生成。
import path from "node:path";
import { createDeepSeekProvider } from "@/core/ai/provider";
import { buildFeedTextBlock } from "@/core/domain/feed-text";
import { localDateStr } from "@/core/domain/calendar";
import { CROSS_DIGESTS_DIR, readCrossDigest } from "@/core/store/file";
import { fingerprintOf, type ArtifactMeta } from "@/core/domain/artifact";
import { readArtifactMeta, writeArtifact } from "@/core/store/artifact";
import { resolveAiConfig } from "@/core/config/ai-config";
import { buildFeed } from "./feed";

function buildPrompt(dateStr: string, block: string): string {
  return `你是面向程序员的技术信息聚合站主笔。以下是根据「各启用源」今日「各源自身已排序」的数据块（源与源不混排）。
请写一篇 400-600 字的简体中文 Markdown 跨源综述，首行用一级标题：# ${dateStr} 跨源综述
要求：
- 各源信息各自保持原样，不要把不同源的 star 与 points 合并排序或编成跨源总榜（二者不可比）。
- 可做的判断：今天各源各自最值得看的是什么；不同源是否在关注同一技术主线（可指出跨源串联）；哪些是虚火/昙花一现。
- 只引用下方数据块已给出的信息，禁止编造 star 数、points、评论数、项目或背景；数据未覆盖的维度不要强行总结。
- 输出纯 Markdown 正文，不要用代码围栏包裹。

今日各源数据（源内已排序）：
${block}`;
}

export interface CrossDigestResult {
  created: boolean;
  content: string;
  /** 本次写入的日期（未创建时为读取到的既有产物日期） */
  date: string;
  /** 产物元数据（force 重生成/首生成=fresh 依据；幂等读取时取自 sidecar，legacy 为 null） */
  meta: ArtifactMeta | null;
}

/** 当前喂入跨源综述的数据（块文本 + 来源指纹 + 数据更新时间）：与生成时同一取数路径（buildFeed→feed-text），零网络零 AI */
async function buildCrossDigestInput(dateStr: string): Promise<{
  block: string;
  sourceFingerprint: string;
  sourceUpdatedAt: string | null;
} | null> {
  const sections = await buildFeed();
  const live = sections.filter((s) => s.items.length > 0);
  if (live.length === 0) return null;
  const block = buildFeedTextBlock(live);
  const times = live.map((s) => s.fetchedAt).filter((x): x is string => !!x);
  const sourceUpdatedAt = times.length ? times.sort((a, b) => Date.parse(b) - Date.parse(a))[0] : null;
  return { block, sourceFingerprint: fingerprintOf({ date: dateStr, block }), sourceUpdatedAt };
}

/** 供新鲜度探测：当前数据指纹（无法计算=暂无数据） */
export async function crossDigestInput(dateStr: string): Promise<{
  sourceFingerprint: string;
  sourceUpdatedAt: string | null;
} | null> {
  const input = await buildCrossDigestInput(dateStr);
  return input ? { sourceFingerprint: input.sourceFingerprint, sourceUpdatedAt: input.sourceUpdatedAt } : null;
}

/** 读取某日既有产物（正文 + meta sidecar；缺 meta = legacy） */
export async function readCrossDigestArtifact(
  dateStr: string,
): Promise<{ content: string; meta: ArtifactMeta | null; file: string } | null> {
  const content = await readCrossDigest(dateStr);
  if (content === null) return null;
  const file = path.join(CROSS_DIGESTS_DIR, `${dateStr}.md`);
  return { content, meta: await readArtifactMeta(file), file };
}

/** 生成（或幂等读取）某日跨源综述；force=true 无视既有产物重新生成（M0.2「重新生成」语义） */
export async function generateCrossDigest(
  dateStr: string = localDateStr(),
  opts: { force?: boolean } = {},
): Promise<CrossDigestResult> {
  // 幂等：本日已生成 → 直接返回，不再消耗 token
  if (!opts.force) {
    const existing = await readCrossDigestArtifact(dateStr);
    if (existing) return { created: false, content: existing.content, date: dateStr, meta: existing.meta };
  }

  const provider = createDeepSeekProvider();
  if (!(await provider.hasKey())) {
    throw Object.assign(new Error("未配置 AI 接入，请先到「设置」页填写"), { status: 503 });
  }

  const input = await buildCrossDigestInput(dateStr);
  if (!input) {
    throw Object.assign(new Error("暂无各源数据，请先点击顶栏刷新趋势"), { status: 400 });
  }
  const { block } = input;

  // 提速（2026-09-11）：综述这类"给定数据写稿"任务不需要隐藏推理。思考型模型（本机网关 Qwen 系）
  // 实测 reasoning_effort:low 只减少不关闭推理，enable_thinking:false 才归零且快约一倍；网关不认时自动降级回 reasoning_effort。
  const content = await provider.completeChat([{ role: "user", content: buildPrompt(dateStr, block) }], {
    signal: AbortSignal.timeout(120_000),
    disableThinking: true,
    reasoningEffort: "low",
    maxTokens: 1200,
    temperature: 0.3,
  });
  const final = content.trim() + "\n";
  const meta: ArtifactMeta = {
    schemaVersion: 1,
    kind: "cross-digest",
    generatedAt: new Date().toISOString(),
    sourceDate: dateStr,
    sourceUpdatedAt: input.sourceUpdatedAt,
    sourceFingerprint: input.sourceFingerprint,
    model: (await resolveAiConfig()).model,
  };
  // 原子写正文 + sidecar；失败时旧产物原样保留（不半写）
  await writeArtifact(path.join(CROSS_DIGESTS_DIR, `${dateStr}.md`), final, meta);
  return { created: true, content: final, date: dateStr, meta };
}
