// 功能开关配置（data/config/features.json）—— 网站「设置 → 功能设置」在线可改，无需改代码/.env，即时生效。
// M1.4 由 lib/features.ts 迁入（逐字）；lib/features.ts 现为 re-export 垫片。
// 默认值口径：web 与 CLI（cli/daily）都读本 TS 为唯一来源（原 scripts/_shared.mjs 镜像已随 M2 删除）。
import fs from 'node:fs/promises';
import path from 'node:path';

export interface FeatureFlags {
  /** 定时任务自动生成 AI 日报（每日洞察，daily.mjs 步骤 3） */
  autoDailyInsight?: boolean;
  /** 定时任务自动生成 AI 周报（daily.mjs 步骤 4）：每周一自动整理上一自然周（周一~周日）；首启从当周周一起、不回补 */
  autoWeeklyReport?: boolean;
  /** 打开仓库详情页且缓存未命中时自动生成「项目决策」AI 解释（M3：取代旧 autoVerdict/autoReview；结论/事实不受开关影响） */
  autoDecision?: boolean;
  /** 打开仓库详情页且缓存未命中时自动生成 AI 同类取舍 */
  autoSimilar?: boolean;
  /** 打开首页且缓存未命中时自动生成「今日跨源值得看」综述（Phase 5；默认关，token 可控） */
  autoCrossDigest?: boolean;
  /** 打开首页时自动为「今日必须看」简报生成 AI 推荐语（M1；默认关——候选与依据始终确定性直出，AI 只润色） */
  autoBriefing?: boolean;
}

export const FEATURE_KEYS = [
  'autoDailyInsight',
  'autoWeeklyReport',
  'autoDecision',
  'autoSimilar',
  'autoCrossDigest',
  'autoBriefing',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** 默认值：日报/周报沿袭既有“每日自动生成”行为；详情页三 AI 默认关闭（沿袭“点按生成、token 可控”） */
export const FEATURE_DEFAULTS: Record<FeatureKey, boolean> = {
  autoDailyInsight: true,
  autoWeeklyReport: true,
  autoDecision: false,
  autoSimilar: false,
  autoCrossDigest: false,
  autoBriefing: false,
};

const CONFIG_PATH = path.join(process.cwd(), 'data', 'config', 'features.json');

// 读-改-写需串行（并发快速拨动多个开关不能互相覆盖），复用 usage/find-cache 的 mutex 链模式
let writeChain: Promise<void> = Promise.resolve();

/** 读取盘上已显式配置的开关（未配置的键不出现在返回值里） */
async function readRaw(): Promise<Partial<Record<FeatureKey, boolean>>> {
  try {
    const obj = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
    const out: Partial<Record<FeatureKey, boolean>> = {};
    for (const k of FEATURE_KEYS) {
      const v = obj[k];
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 读取全部开关：显式配置优先，其余回默认值。返回含全部键的布尔对象。 */
export async function readFeatures(): Promise<Record<FeatureKey, boolean>> {
  const raw = await readRaw();
  return { ...FEATURE_DEFAULTS, ...raw };
}

/** 合并写回若干开关（值为布尔），返回写后的全部开关（含默认值补全） */
export async function writeFeatures(
  partial: Partial<Record<FeatureKey, boolean>>,
): Promise<Record<FeatureKey, boolean>> {
  const keys = FEATURE_KEYS.filter((k) => partial[k] !== undefined);
  if (keys.length === 0) return readFeatures();
  const run = writeChain.then(async () => {
    const raw = await readRaw();
    for (const k of keys) raw[k] = partial[k] as boolean;
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await fs.writeFile(CONFIG_PATH, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
  });
  writeChain = run.catch(() => {});
  await run;
  return readFeatures();
}
