// 网站数据层类型定义（M1.2 由 lib/types.ts 整体迁入；lib/types.ts 现为 re-export 垫片）
// 与 data/ 目录下 JSON 结构一一对应。新增/修改类型请同步改此处（勿双写）。
import type { Verdict } from "./signals";
import type { ArtifactFreshness, ArtifactMeta } from "./artifact";

/** 新星榜条目（latest.json.new_stars[]） */
export interface NewStarRepo {
  rank: number;
  full_name: string;
  description: string | null;
  /** DeepSeek 生成的一句话中文摘要（可缺省） */
  summary?: string | null;
  language: string | null;
  stars: number;
  created_at: string;
  topics: string[];
  html_url: string;
  /** 相对前一天的 star 增量（搜索榜无昨日对比时缺省） */
  delta_1d?: number | null;
  /** 判读信号（GitHub 即时公开字段，供 lib/signals.ts 计算；未回填前缺省 → 判读条优雅隐藏） */
  pushed_at?: string | null;
  archived?: boolean | null;
  license?: string | null;
  /** M3 事实区：fork 数 / 未关闭 issue 数（2026-09-18 起管道写入；旧快照缺省 → 界面显 —） */
  forks?: number | null;
  open_issues?: number | null;
}

/**
 * GitHub Explore 趋势榜条目（latest.json.trending[]；抓 github.com/trending?since=daily 页所得）。
 * 口径=当日新增 star（与 Explore 一致）；详情字段（topics/pushed_at/license…）由 /repos 富化补充，
 * 限流或抓取失败时缺省 → 判读 chips/标签优雅隐藏。feed GitHub 板块有它则优先于 new_stars。
 */
export interface TrendingRepo {
  rank: number;
  full_name: string;
  description: string | null;
  /** DeepSeek 生成的一句话中文摘要（可缺省） */
  summary?: string | null;
  language: string | null;
  /** 总 star（详情富化命中时取 API 值，否则取页面值） */
  stars: number;
  /** Explore 展示的本日新增 star（feed 映射时即 delta 语义） */
  stars_today: number;
  forks?: number | null;
  html_url: string;
  /** ↓ 以下来自 /repos 详情富化；未富化则缺省（未知 ≠ 无） */
  topics?: string[];
  created_at?: string;
  pushed_at?: string | null;
  archived?: boolean | null;
  license?: string | null;
  /** M3 事实区：未关闭 issue 数（详情富化命中才有） */
  open_issues?: number | null;
}

/** 追踪池条目（latest.json.tracked[]） */
export interface TrackedRepo {
  full_name: string;
  stars: number;
  delta_1d: number | null;
  language: string | null;
  description: string | null;
  summary?: string | null;
  html_url?: string;
  topics?: string[];
  created_at?: string;
  /** 判读信号（缺省 → 判读条优雅隐藏） */
  pushed_at?: string | null;
  archived?: boolean | null;
  license?: string | null;
  /** M2：限流/拉取失败时沿用上次已知数据——本字段记录该行数据的实际抓取时间（缺省=本轮新鲜） */
  dataUpdatedAt?: string;
  /** M3 事实区：fork 数 / 未关闭 issue 数（旧快照缺省 → 界面显 —） */
  forks?: number | null;
  open_issues?: number | null;
}

/** 当日聚合数据（data/latest.json） */
export interface LatestData {
  updated_at: string;
  date: string;
  new_stars: NewStarRepo[];
  tracked: TrackedRepo[];
  /** 追踪池实际更新到的条数（限流时可能 < 池总数） */
  tracked_updated: number;
  /** GitHub Explore 趋势榜（2026-09 起；页面抓取失败/旧数据缺省 → feed 回落 new_stars） */
  trending?: TrendingRepo[];
}

/** 每日追踪池快照（data/history/{YYYY-MM-DD}.json） */
export interface HistoryEntry {
  date: string;
  repos: Array<{
    full_name: string;
    stars: number;
    language: string | null;
    description: string | null;
    /** 信号打底（切片3 起快照写入；旧文件缺省 → 雷达/判读优雅降级） */
    topics?: string[];
    created_at?: string;
    pushed_at?: string | null;
    archived?: boolean;
    license?: string | null;
    /** 当日判读标签冻结（切片3 二轮起写入；镜像 signals 保守规则，供"应验"回看） */
    verdict?: string[];
  }>;
}

/** GitHub API 返回的仓库对象（仅取用字段） */
export interface GhRepo {
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  created_at: string;
  topics: string[];
  html_url: string;
  /** 最后提交时间（判断维护活跃度） */
  pushed_at?: string | null;
  /** 是否已被作者归档 */
  archived?: boolean | null;
  /** 开源许可证（Search/Repos API 返回；无许可证为 null） */
  license?: { spdx_id: string | null } | null;
  forks_count?: number;
  open_issues_count?: number;
}

/** /api/similar 返回的「同类项目」条目（详情页渲染；字段兼容 VerdictChips 的 VerdictSource 三态语义） */
export interface SimilarItem {
  full_name: string;
  description: string | null;
  /** 本地今日池命中才有 */
  summary?: string | null;
  language: string | null;
  stars: number;
  created_at?: string | null;
  topics: string[];
  html_url: string;
  /** 本地今日池命中才有 */
  delta_1d?: number | null;
  /** undefined=未知（不出 chip）；null=确无该字段 → 触发相应 chip */
  pushed_at?: string | null;
  archived?: boolean | null;
  license?: string | null;
  /** 与本仓库共享的「具体话题」数 */
  overlap: number;
  /** 来源：本地今日池 / GitHub 搜索 */
  fromLocal: boolean;
  /** AI 一句中文取舍；null = 无 AI（见 aiSkipped） */
  takeaway: string | null;
}

/** M3 /api/compare 事实矩阵行（确定性字段；growth7d=本站快照区间，样本不足为 null） */
export interface CompareRepoData {
  fullName: string;
  positioning: string | null;
  language: string | null;
  license: string | null;
  licenseKnown: boolean;
  archived: boolean;
  stars: number;
  deltaToday: number | null;
  growth7d: { from: string; to: string; delta: number | null; note?: string } | null;
  forks: number | null;
  openIssues: number | null;
  pushedAt: string | null;
  lastPushDays: number | null;
  createdAt: string | null;
  latestRelease: { tag: string; publishedAt: string | null } | null;
  deployHints: string[];
  risks: string[];
}

/** /api/similar 响应 */
export interface SimilarResponse {
  cached: boolean;
  similar: SimilarItem[]; // ≤4 行
  /** true = 本响应无 AI 取舍（无 key / AI 失败 / no-ai 缓存命中） */
  aiSkipped: boolean;
  /** 展示给用户的提示（配额不足 / 无 key / 未找到同类） */
  note?: string | null;
  /** peek 模式下未命中缓存 → false，前端给"生成"按钮（不自动调用 AI） */
  available?: boolean;
  /** M0.2：命中缓存时相对当前输入的新鲜度（缺省=旧缓存无元数据语义，前端按 legacy 处理） */
  freshness?: ArtifactFreshness;
  /** M0.2：产物元数据（来源版本）；legacy 缓存为 null */
  meta?: ArtifactMeta | null;
  /** M0.2：重新生成失败但仍返回旧内容时的错误说明（界面"保留旧内容并展示错误"） */
  genError?: string | null;
}

// ---------------------------------------------------------------------------
// 中立 item（多源聚合的目标模型，见 docs/architecture.md §4.1 / multisource-design §3.2）。
// 骨架先立：source/source_id 复合身份 + 可扩展度量袋 + 溯源 meta。落地随 M3 新源推进。
// ---------------------------------------------------------------------------

export type SourceId = string; // "github" | "hackernews" | "arxiv" | …

/** 每源原生度量（star ≠ points ≠ 引用数，绝不跨源合并排名） */
export interface SourceMetric {
  name: string; // "stars" | "points" | "num_comments" | "citations" …
  value: number;
  at?: string; // 度量时间点
}

/** 聚合站点位模型：源的 discover 层统一收敛点；source_id 为该源内唯一（github=owner/name） */
export interface SourceItem {
  source: SourceId;
  source_id: string;
  title: string;
  url: string;
  description?: string | null;
  published_at?: string; // 源的"发布/最后可见"时间
  discovered_at: string; // 首次进快照日期（雷达 firstSeen 的来源）
  language?: string | null;
  tags?: string[]; // github=topics；其它源尽力映射，无则 []
  metrics: SourceMetric[];
  _meta: { fetched_at: string }; // 溯源：AI 只许引用快照已给数据
}

// ---------------------------------------------------------------------------
// 统一信息流（feed，Phase 4 聚合首页）——中立条目与板块，见 architecture.md §4.10。
// key = `${source}:${source_id}` 全局唯一；各源自归一排序、并列分块，度量绝不跨源混比。
// ---------------------------------------------------------------------------

/** feed 单条：中立可渲染卡片（源码标签 + 各自原生度量 + 可选 chips + 关注态） */
export interface FeedItem {
  key: string; // `${source}:${source_id}`（全局唯一）
  source: SourceId;
  /** 源内唯一 id（github=owner/name · hn=objectID）——供详情页路由等派生 */
  sourceId: string;
  sourceLabel: string;
  title: string;
  url: string;
  description: string | null;
  tags: string[];
  /** 该源原生度量，单值展示（用于源内可比，绝不跨源合并排名） */
  metric: { name: string; value: number; label: string } | null;
  /** 额外原生度量（格式化文本）：GitHub 当日增量 / HN 评论数。非跨源可比项，仅作卡片增强 */
  secondary?: string | null;
  /** 该源 profile 算出的判读 chips（GitHub 有；HN 首期无 → null） */
  signals: Verdict | null;
  discoveredAt: string;
  /** 是否在跨源 watchlist */
  watched: boolean;
  /** 跨源去重/串联（Phase 5）：同「subject」条目（GitHub↔HN 同一技术）共享同一 groupId；无则缺省 */
  groupId?: string | null;
}

/** feed 板块：一个源（或一个语义分组）的条目集合 */
export interface FeedSection {
  id: string; // "github" | "hackernews" | …
  title: string;
  sourceLabel: string;
  items: FeedItem[];
}

/** 跨源关注条目（data/config/watchlist.json） */
/**
 * 跨源关注条目。M2 扩展（product-optimization-plan §8.5）：note + snapshot 均为可选，
 * 只含 source/source_id/addedAt 的旧记录必须照常读取（旧记录界面标「历史关注」）。
 */
export interface WatchlistEntry {
  source: string;
  source_id: string;
  addedAt: string;
  /** 用户备注（预留；第一版界面不编辑） */
  note?: string;
  /** 加入关注时从今日快照捕获的展示信息——条目离开榜单后关注页仍可解释"关注的是什么" */
  snapshot?: {
    title: string;
    url: string;
    description?: string | null;
    /** 最后一次已知原生度量文案（如 ★ 12,345 / 455 赞）；不承诺持续抓取，仅关注当日/最后刷新记录 */
    lastMetricLabel?: string | null;
    capturedAt: string;
  };
}

// ---------------------------------------------------------------------------
// GitHub 热榜（存量榜，独立页面 /hot；与首页「今日增量流」口径不混）。
// 类目配置 = 查询式单一真相源（data/config/hot-categories.json，git 可 diff）；
// 快照 data/hot/latest.json + data/hot/history/{date}.json，运行期零 AI（纯 searchRepos 重建）。
// ---------------------------------------------------------------------------

/** 一个分类类目（配置形状；queries 是该类目质量的唯一真相源） */
export interface HotCategoryConfig {
  id: string;
  label: string;
  /** GitHub Search repositories 查询式（1–2 条；stars 门槛由采集器运行时附加，勿写进查询式） */
  queries: string[];
  /** 类目 star 门槛（采集器实际生效 = max(全局硬门槛 5000, starFloor)） */
  starFloor: number;
}

/** 热榜条目（快照 categories[].items[]；总 star 口径存量榜） */
export interface HotRepo {
  rank: number;
  full_name: string;
  description: string | null;
  /** DeepSeek 生成的一句话中文摘要（可缺省） */
  summary?: string | null;
  language: string | null;
  stars: number;
  forks?: number | null;
  html_url: string;
  topics: string[];
  created_at: string;
  pushed_at: string | null;
  archived?: boolean | null;
  license?: string | null;
}

/** 热榜分类板块 */
export interface HotCategorySection {
  id: string;
  label: string;
  items: HotRepo[];
}

/** 出榜记录（过滤原因落盘可见；技术性垃圾带规则名） */
export interface HotFilteredEntry {
  full_name: string;
  /** 出榜原因（中文，直接可展示） */
  reason: string;
  /** 命中的类目 id（多类目同仓只出榜一次，记录全部涉及类目） */
  categories: string[];
}

/** 热榜最新快照（data/hot/latest.json；history/{date}.json 同构） */
export interface HotLatest {
  updated_at: string;
  date: string;
  categories: HotCategorySection[];
  filtered: HotFilteredEntry[];
}
