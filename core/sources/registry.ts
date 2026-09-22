// 源注册表：所有可用源的统一清单（id + label + adapter）。供 run-source / daily / feed 枚举。
// 让「加源/删源」从改多处硬编码简化为：加一个 adapter + 在 registry 登记 + 控制启用源配置。
// 注意：registry 只登记"可用源"，不决定"是否启用"——启用与否由 data/config/active-sources.json 决定（core/config/sources）。
import type { SourceAdapter } from "./adapter";
import { githubAdapter } from "./github/adapter";
import { hackernewsAdapter } from "./hackernews/adapter";
import { juejinAdapter } from "./juejin/adapter";
import { cnblogsAdapter } from "./cnblogs/adapter";

export interface SourceDef {
  id: string;
  label: string;
  adapter: SourceAdapter;
  /** 网络要求说明（M5 §11.2 设置页展示；缺省=国内可直连） */
  networkHint?: string;
}

/** 全部可用源（保持登记顺序） */
export const ALL_SOURCES: SourceDef[] = [
  { id: "github", label: "GitHub 仓库趋势", adapter: githubAdapter },
  { id: "hackernews", label: "Hacker News", adapter: hackernewsAdapter, networkHint: "外网源：需代理/梯子才能拉取，国内网络常失败，默认关闭" },
  { id: "juejin", label: "掘金", adapter: juejinAdapter, networkHint: "国内直连" },
  { id: "cnblogs", label: "博客园", adapter: cnblogsAdapter, networkHint: "国内直连" },
];

const BY_ID = new Map(ALL_SOURCES.map((s) => [s.id, s]));

export function sourceById(id: string): SourceDef | undefined {
  return BY_ID.get(id);
}

export function sourceLabel(id: string): string {
  return sourceById(id)?.label ?? id;
}

/** 按启用源顺序取 adapter（过滤未知 id，避免配置错误拖垮整链） */
export function activeAdapters(activeIds: string[]): SourceAdapter[] {
  return activeIds.map((id) => sourceById(id)?.adapter).filter((a): a is SourceAdapter => !!a);
}
