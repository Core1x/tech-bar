// 热榜类目配置（data/config/hot-categories.json）：10 个预设分类，每类 { id, label, queries[], starFloor }。
// queries 是类目质量的唯一真相源（GitHub Search 查询式，人可读、git 可 diff）；扩展类目 = 加配置条目。
// 读侧容错：非法条目跳过；空配置 → []（采集器据此拒绝重建并提示先生成）。写侧 atomicWrite + 模块级串行（与其它 config 一致）。
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR, atomicWrite } from "@/core/store/file";
import type { HotCategoryConfig } from "@/core/domain/types";

export const HOT_CATEGORIES_FILE = path.join(CONFIG_DIR, "hot-categories.json");

/** 全局 star 硬门槛（技术性垃圾过滤；类目 starFloor 只会更高不会低于它） */
export const GLOBAL_STAR_FLOOR = 5000;

export async function readHotCategories(): Promise<HotCategoryConfig[]> {
  try {
    const raw = JSON.parse(await fs.readFile(HOT_CATEGORIES_FILE, "utf-8")) as unknown;
    const list = Array.isArray(raw) ? raw : (raw as { categories?: unknown })?.categories;
    if (!Array.isArray(list)) return [];
    const out: HotCategoryConfig[] = [];
    for (const e of list) {
      const c = e as Partial<HotCategoryConfig>;
      if (!c || typeof c.id !== "string" || typeof c.label !== "string" || !Array.isArray(c.queries)) continue;
      const queries = c.queries.filter((q): q is string => typeof q === "string" && q.trim() !== "");
      if (queries.length === 0) continue;
      const floor = Number.isFinite(c.starFloor) ? Math.max(GLOBAL_STAR_FLOOR, Number(c.starFloor)) : GLOBAL_STAR_FLOOR;
      out.push({ id: c.id, label: c.label, queries, starFloor: floor });
    }
    return out;
  } catch {
    return []; // 无文件/损坏 → 空（采集器拒绝重建）
  }
}

let writeCategoriesChain: Promise<void> = Promise.resolve();
export async function writeHotCategories(cats: HotCategoryConfig[]): Promise<void> {
  const run = writeCategoriesChain.then(async () => {
    await ensureHotDir();
    await atomicWrite(HOT_CATEGORIES_FILE, JSON.stringify(cats, null, 2) + "\n");
  });
  writeCategoriesChain = run.then(
    () => undefined,
    () => undefined,
  );
  await run;
}

async function ensureHotDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

/** 该类目实际生效 star 门槛 = max(全局硬门槛, starFloor) */
export function effectiveStarFloor(c: HotCategoryConfig): number {
  return Math.max(GLOBAL_STAR_FLOOR, c.starFloor);
}
