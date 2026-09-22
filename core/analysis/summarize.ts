// 中文摘要生成（daily 步骤 2 迁入 core/analysis）：为榜单缺失中文点评的仓库批量补一句点评，
// 写入 data/cache/summaries.json（键 = summaryKey），并回写对应 latest 的 summary 字段。
// 单源逻辑（唯一实现），web/CLI 共用；走 core/ai provider 计用量与 key 门控。
// GitHub 榜单（new_stars/tracked/trending）与热榜（/hot）共用同一 summaries 缓存与批处理 helper。
import {
  readLatest,
  writeLatest,
  readSummaries,
  writeSummaries,
  readHotLatest,
  writeHotLatest,
} from "@/core/store/file";
import { summaryKey } from "@/core/domain/summary";
import { createDeepSeekProvider } from "@/core/ai/provider";

/** 从模型输出中提取 JSON 对象（容忍 ```json 围栏与前后文本） */
function extractJsonObject(text: string): Record<string, unknown> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) {
    throw new Error(`无法从模型输出解析 JSON：${text.slice(0, 200)}`);
  }
  try {
    const parsed = JSON.parse(m[0]) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("非对象");
    return parsed as Record<string, unknown>;
  } catch (e) {
    throw new Error(`模型输出 JSON 解析失败：${(e as Error).message}`);
  }
}

interface NeedItem {
  full_name: string;
  description: string;
  key: string;
}

/** 单批 AI 调用上限（控 prompt 体积与超时；超出分多批） */
const BATCH = 25;

/**
 * 给 need 中缺摘要的仓库生成一句话中文点评，就地合并进 summaries（不落盘，调用方决定写时机）。
 * 分批调用；某批失败仅告警、保留已成功批次（幂等：下次续跑未命中的键）。
 */
async function summarizeInto(
  provider: ReturnType<typeof createDeepSeekProvider>,
  summaries: Record<string, string>,
  need: NeedItem[],
): Promise<number> {
  let added = 0;
  for (let i = 0; i < need.length; i += BATCH) {
    const batch = need.slice(i, i + BATCH);
    const listText = batch.map((n) => `- ${n.full_name}: ${n.description || "（无描述）"}`).join("\n");
    const prompt = `请为以下 GitHub 仓库各写一句简洁的中文点评（30 字以内，突出项目用途或亮点）。\n只输出一个 JSON 对象，键为完整仓库名（owner/repo），值为一句话点评。不要输出任何其他内容。\n\n${listText}`;
    try {
      const content = await provider.completeChat([{ role: "user", content: prompt }]);
      const parsed = extractJsonObject(content);
      for (const [name, text] of Object.entries(parsed)) {
        const hit = batch.find((n) => n.full_name === name);
        if (hit && typeof text === "string" && text.trim()) {
          summaries[hit.key] = text.trim();
          added++;
        }
      }
    } catch (err) {
      console.warn(`[摘要] 批次失败（${(err as Error).message}），跳过本批`);
    }
  }
  return added;
}

export interface SummarizeResult {
  added: number;
  total: number;
  /** true = 未配置 AI key，跳过（调用方决定文案） */
  skipped: boolean;
  message: string;
}

/** 为最新 new_stars 补一句点评（幂等：已有 summary 的键跳过）；回写 latest.json 全部板块的 summary */
export async function runSummarizeNewStars(): Promise<SummarizeResult> {
  const provider = createDeepSeekProvider();
  const latest = await readLatest();
  if (!latest) {
    return { added: 0, total: 0, skipped: true, message: "data/latest.json 不存在，先更新数据" };
  }
  if (!(await provider.hasKey())) {
    return { added: 0, total: 0, skipped: true, message: "未配置 DEEPSEEK_API_KEY，跳过（榜单显示原文描述）" };
  }

  // 浅拷贝：summarizeInto 会在写盘前长时间就地合并新摘要，避免污染 store 的文件级缓存共享对象
  const summaries = { ...((await readSummaries()) ?? {}) };
  const need: NeedItem[] = [];
  for (const repo of latest.new_stars.slice(0, 30)) {
    const key = summaryKey(repo.full_name, repo.description ?? "");
    if (!summaries[key]) need.push({ full_name: repo.full_name, description: repo.description ?? "", key });
  }

  let added = 0;
  if (need.length > 0) {
    added = await summarizeInto(provider, summaries, need);
    await writeSummaries(summaries);
  }

  // 无论是否新增都回写 latest.json 的 summary，保证榜单立即显示中文摘要
  // （update 先写 latest、摘要后生成，顺序上需要这一步补齐）
  for (const repo of latest.new_stars) {
    repo.summary = summaries[summaryKey(repo.full_name, repo.description ?? "")] ?? null;
  }
  for (const repo of latest.tracked) {
    repo.summary = summaries[summaryKey(repo.full_name, repo.description ?? "")] ?? null;
  }
  for (const repo of latest.trending ?? []) {
    repo.summary = summaries[summaryKey(repo.full_name, repo.description ?? "")] ?? null;
  }
  await writeLatest(latest);

  return { added, total: Object.keys(summaries).length, skipped: false, message: `新增 ${added} 条中文点评（缓存共 ${Object.keys(summaries).length} 条）` };
}

/**
 * 为热榜快照（data/hot/latest.json）内缺中文摘要的仓库增量补全（幂等、单次有上限，可反复跑直至完整）。
 * 去重跨类目；`max` 限制单次生成条数（默认 80，控 token）；生成后就地回写快照 summary 字段。
 * 无快照 / 无 key → skipped；剩余待补数在 message 回报（"还有 N 条，再跑一次"）。
 */
export async function runSummarizeHot(opts: { max?: number } = {}): Promise<SummarizeResult> {
  const provider = createDeepSeekProvider();
  const latest = await readHotLatest();
  if (!latest) {
    return { added: 0, total: 0, skipped: true, message: "data/hot/latest.json 不存在，先重建热榜" };
  }
  if (!(await provider.hasKey())) {
    return { added: 0, total: 0, skipped: true, message: "未配置 DEEPSEEK_API_KEY，跳过（热榜显示原文描述）" };
  }

  // 浅拷贝：summarizeInto 会在写盘前长时间就地合并新摘要，避免污染 store 的文件级缓存共享对象
  const summaries = { ...((await readSummaries()) ?? {}) };
  const seen = new Set<string>();
  const need: NeedItem[] = [];
  let remainingAll = 0;
  for (const cat of latest.categories) {
    for (const repo of cat.items) {
      const key = summaryKey(repo.full_name, repo.description ?? "");
      if (summaries[key]) continue;
      remainingAll++;
      if (seen.has(repo.full_name)) continue; // 跨类目同仓只需生成一次
      seen.add(repo.full_name);
      need.push({ full_name: repo.full_name, description: repo.description ?? "", key });
    }
  }

  const cap = opts.max ?? 80;
  const batch = need.slice(0, cap);
  let added = 0;
  if (batch.length > 0) {
    added = await summarizeInto(provider, summaries, batch);
    await writeSummaries(summaries);
  }

  // 回写快照 summary（含本轮新生成 + 历史已有）
  for (const cat of latest.categories) {
    for (const repo of cat.items) {
      repo.summary = summaries[summaryKey(repo.full_name, repo.description ?? "")] ?? null;
    }
  }
  await writeHotLatest(latest);

  const left = Math.max(0, remainingAll - added);
  const message =
    need.length === 0
      ? "热榜中文摘要已完整"
      : `本轮新增 ${added} 条（单次上限 ${cap}）${left > 0 ? `，还有约 ${left} 条待补，可再跑一次` : "，已全部补全"}`;
  return { added, total: Object.keys(summaries).length, skipped: false, message };
}
