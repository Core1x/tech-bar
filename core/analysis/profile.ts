// 各源「详情入口」分派注册表（Phase 5 的 D 块基座）：把 source 映射到其内部详情页 href。
// github → /repo/{owner/name}（深潜：判读/同类/README）；hackernews → /hn/{objectID}（本地详情页）。
// 薄、只做分派；各源的深度判读面（signals/profile）逐源演进，本表只管"点条目去哪看详情"。
// 供 FeedCard / FeedBoard（presentation）与路由共用 —— 替换此前散写的 isGithub 二分支。
export interface SourceProfile {
  source: string;
  itemHref(sourceId: string): string;
}

export const SOURCE_PROFILES: Record<string, SourceProfile> = {
  github: { source: "github", itemHref: (sourceId) => `/repo/${sourceId}` },
  hackernews: { source: "hackernews", itemHref: (sourceId) => `/hn/${sourceId}` },
};

/** 某源条目的内部详情 href；未知源返回 ""（调用方回落到外部 url） */
export function itemHrefFor(source: string, sourceId: string): string {
  return SOURCE_PROFILES[source]?.itemHref(sourceId) ?? "";
}
