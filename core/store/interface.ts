// store 层 repository 边界契约（M1.3 建立；多源/切库的目标形态见 docs/architecture.md §4.2）。
// M1.3 落地 FileStore（core/store/file.ts，仍读旧顶层路径）；SQLite 将来实现同一接口即可换入。
// 说明：M1.3 先把「repository 应长什么样」以类型定下来；接入 createCore 组合根与调用方切换在 M1.5+ 做，
// 因此本文件的类型当前未被引用（导出即可，tsc/eslint 无碍）。
import type { HistoryEntry, LatestData } from "@/core/domain/types";

/** 每源每日聚合快照写入的最小单元（现为"当日追踪池 repos 数组"，多源后泛化为 SourceItem[]） */
export interface SnapshotRepo {
  full_name: string;
  stars: number;
  language: string | null;
  description: string | null;
  topics?: string[];
  created_at?: string;
  pushed_at?: string | null;
  archived?: boolean;
  license?: string | null;
  verdict?: string[];
}

/** 写入一个 {date,repos} 快照（现写入 data/history/{date}.json） */
export interface HistoryWriter {
  writeHistory(entry: { date: string; repos: SnapshotRepo[] }): Promise<void>;
}

/**
 * 数据存储的抽象切片（示意，非穷尽）：
 * - latest/history 现为 GitHub 单源顶层路径；M2 源分区后接口签名加 source，且保留"读旧位置先于新分区"垫片。
 * - summaries/readme/star 索引/状态锁等 cache 与 config 归同层其它切片，调用方不感知实现是文件还是库。
 */
export interface DataStoreSlices {
  latest(): Promise<LatestData | null>;
  writeLatest(data: LatestData): Promise<void>;
  history(date: string): Promise<HistoryEntry | null>;
  listDates(): Promise<string[]>;
  writeSnapshot(entry: { date: string; repos: SnapshotRepo[] }): Promise<void>;
}
