// per-source 调度判定纯函数（M1.5 骨架；决策集中 core，改 cadence = 改配置不改脚本，ADR A5）。
// 语义：源"最近一次成功快照时间"距今超过其 cadence 即到期该跑；从未跑过 → 必跑。
// 时间一律用毫秒时间戳参与纯函数，YYYY-MM-DD 快照日 → ms 的换算在调用方（store 层）做。
import type { SourceRunResult } from "../sources/adapter";

export interface SourceCadence {
  sourceId: string;
  /** 两次运行最小间隔（毫秒）。github 默认日更 = 24h；将来 HN/arxiv 可更短。 */
  cadenceMs: number;
}

/** 单源是否到期：lastRunAtMs=null（从未跑过）或 now-last ≥ cadence 为 true */
export function isDue(nowMs: number, lastRunAtMs: number | null, cadenceMs: number): boolean {
  return lastRunAtMs === null || nowMs - lastRunAtMs >= cadenceMs;
}

/** 在 cadences 表中过滤出到期要跑的源（未登记的源：不自动跑，需显式 run） */
export function dueSources(
  cadences: SourceCadence[],
  lastRuns: Record<string, number | null>,
  nowMs: number,
): string[] {
  const out: string[] = [];
  for (const c of cadences) {
    if (isDue(nowMs, lastRuns[c.sourceId] ?? null, c.cadenceMs)) out.push(c.sourceId);
  }
  return out;
}

/** 从"跑了哪些源"折叠成 lastRuns 的新状态（供调用方持久化） */
export function foldLastRuns(
  prev: Record<string, number | null>,
  results: SourceRunResult[],
  nowMs: number,
): Record<string, number | null> {
  const next: Record<string, number | null> = { ...prev };
  for (const r of results) {
    // 只有真跑了且成功才更新"最后跑"；skipped（未到期/无更新）与失败都不更新
    if (r.ok && !r.skipped) next[r.sourceId] = nowMs;
  }
  return next;
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
