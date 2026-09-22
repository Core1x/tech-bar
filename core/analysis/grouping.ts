// 跨源去重/串联（Phase 5，docs/architecture.md §4.10 backlog ①：确定性归一）。
// 对同一次 buildFeed 的全部 FeedItem 按「canonical subject key」聚簇（URL 命中优先，标题归一兜底），
// 给同一技术的跨源条目写共享 groupId。保守规则：仅当一组 ≥2 个**不同源**才成组（单源内按 full_name/objectID 本就唯一，
// 避免同名 repo 误并）。② LLM 聚类不在本次。
import { canonicalSubjectKey } from "@/core/domain/canonical";
import type { FeedItem } from "@/core/domain/types";
import { feedItemKey } from "./feed";

export interface GroupResult {
  /** item.key → groupId 分配（仅成组条目；单条目/跨源不足不给） */
  assignments: Map<string, string>;
  /** groupId → 该组条目（每组 ≥2 个不同源） */
  groups: Map<string, FeedItem[]>;
}

/** 对一组 FeedItem 聚簇：返回分配表 + 组表。纯函数（canonical 归一 + 判定），可单测。 */
export function groupFeedItems(items: FeedItem[]): GroupResult {
  const raw = new Map<string, FeedItem[]>();
  const order: string[] = [];
  for (const it of items) {
    const subject = canonicalSubjectKey(it);
    if (!subject) continue;
    let bucket = raw.get(subject);
    if (!bucket) {
      bucket = [];
      raw.set(subject, bucket);
      order.push(subject);
    }
    bucket.push(it);
  }

  const assignments = new Map<string, string>();
  const groups = new Map<string, FeedItem[]>();
  for (const subject of order) {
    const bucket = raw.get(subject)!;
    // 至少两个不同源才算跨源串联（避免把单源内的同名条目误并）
    const srcs = new Set(bucket.map((i) => i.source));
    if (srcs.size < 2) continue;
    groups.set(subject, bucket);
    for (const it of bucket) assignments.set(feedItemKey(it.source, it.sourceId), subject);
  }
  return { assignments, groups };
}

/** 应用分组结果到一组 item（返回带 groupId 的新对象数组；未成组的 groupId 置 null） */
export function applyGrouping(items: FeedItem[], assignments: Map<string, string>): FeedItem[] {
  return items.map((it) => {
    const gid = assignments.get(it.key);
    return gid ? { ...it, groupId: gid } : it;
  });
}
