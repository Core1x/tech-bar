// GitHub 热榜过滤规则（纯函数、零 I/O，服务端/CLI/单测共用）。两条规则口径各异，勿混：
//   1) 技术性垃圾（archived/fork/无描述/无 README/star 低于门槛）→ 硬排除，原因落盘可见；
//   2) 长期未维护（pushed_at 超 12 个月）→ 保留 + 标记：不在此层，由 computeSignals 的
//      「超1年未更新」红 chip 承担（快照条目透传 pushed_at 即自动成立）。
// 出榜记录只带中文原因（技术性规则），页面「已过滤」面板据此展示、理由可见。

/** 技术性垃圾规则的判定输入（Search 结果映射后的最小形状） */
export interface HotFilterInput {
  full_name: string;
  description: string | null;
  topics: string[];
  stars: number;
  archived?: boolean;
  fork?: boolean;
  /** README 探测结果："y"=有 / "n"=确无（硬排除）/ 缺省=未知（探测失败或跳过 → 保留，宁漏不误伤） */
  readme?: "y" | "n";
}

/** 技术性垃圾硬排除：命中返回中文原因，未命中返回 null。门槛传类目生效值（采集器算好） */
export function hardExcludeReason(item: HotFilterInput, starFloor: number): string | null {
  if (item.archived === true) return "已归档";
  if (item.fork === true) return "Fork 仓库";
  if (!item.description || item.description.trim() === "") return "无描述";
  if (item.readme === "n") return "无 README";
  if (!(item.stars >= starFloor)) return `star 低于门槛 ${starFloor}`;
  return null;
}

// ---------------- 装配（纯函数：原始条目 → 分类板块 + 出榜记录） ----------------

export interface HotAssembleCategory {
  id: string;
  label: string;
  /** 该类目生效 star 门槛（max(全局, 类目)） */
  starFloor: number;
  /** 原始条目（可含跨查询重复与多类目重复——类目内按 full_name 去重，跨类目允许共存） */
  items: Array<
    HotFilterInput & {
      language: string | null;
      stars: number;
      forks?: number | null;
      html_url: string;
      created_at: string;
      pushed_at: string | null;
      license?: string | null;
    }
  >;
}

export interface HotAssembleResult<CategoryOut> {
  categories: Array<{ id: string; label: string; items: CategoryOut[] }>;
  /** 出榜记录（仓库级去重；多类目涉及同一仓只出一条、categories 记全） */
  filtered: Array<{
    full_name: string;
    reason: string;
    categories: string[];
  }>;
}

/** 出榜原因（技术性规则）：命中返回中文原因，未命中返回 null。 */
export function excludeReasonFor(item: HotFilterInput, starFloor: number): string | null {
  return hardExcludeReason(item, starFloor);
}

/**
 * 装配各分类板块：类内去重 → 过滤（出榜记录）→ 按总 star 降序 → 排名。
 * 多归属允许：同一仓库可同现于多个类目板块；被排除则全局排除（记全部涉及类目）。
 */
export function assembleHotSections<C extends { id: string; label: string; starFloor: number } & HotAssembleCategory>(
  cats: C[],
): HotAssembleResult<C["items"][number]> {
  const filteredByKey = new Map<string, { full_name: string; reason: string; categories: string[] }>();
  const categories: HotAssembleResult<C["items"][number]>["categories"] = [];

  for (const cat of cats) {
    const byName = new Map<string, C["items"][number]>(); // 类内跨查询去重（先出现者保留）
    for (const item of cat.items) {
      if (!byName.has(item.full_name)) byName.set(item.full_name, item);
    }
    const kept: C["items"][number][] = [];
    for (const item of byName.values()) {
      const reason = excludeReasonFor(item, cat.starFloor);
      if (reason) {
        const prev = filteredByKey.get(item.full_name);
        if (prev) {
          if (!prev.categories.includes(cat.id)) prev.categories.push(cat.id);
        } else {
          filteredByKey.set(item.full_name, { full_name: item.full_name, reason, categories: [cat.id] });
        }
        continue;
      }
      kept.push(item);
    }
    kept.sort((a, b) => b.stars - a.stars);
    categories.push({ id: cat.id, label: cat.label, items: kept });
  }

  return { categories, filtered: [...filteredByKey.values()] };
}

/**
 * M3 §9.6 同类候选质量门槛（/api/similar 收集与 AI 之前统一过一遍）：
 * 归档仓默认排除；0 star 或信息严重缺失（无描述且无摘要且无话题）不进入推荐——
 * 宁缺勿凑，返回出圈原因（null=合格）。纯函数，供单测。
 */
export function similarCandidateDisqualifies(c: {
  stars?: number | null;
  description?: string | null;
  summary?: string | null;
  topics?: string[] | null;
  archived?: boolean | null;
}): string | null {
  if (c.archived === true) return "已归档";
  if ((c.stars ?? 0) <= 0) return "无 star";
  const hasDesc = Boolean((c.summary || c.description || "").trim());
  const hasTopics = Array.isArray(c.topics) && c.topics.length > 0;
  if (!hasDesc && !hasTopics) return "信息缺失";
  return null;
}
