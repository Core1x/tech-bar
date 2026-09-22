// 启用源配置（data/config/active-sources.json）—— 决定哪些源被拉取/进 feed。
// 默认（第一次运行、无配置时）：仅 github + 国内源（juejin/cnblogs），**默认不含 hackernews**（外网、需梯子，用户已确认移除）。
// 将来要开某源：往文件加对应 id；要关：移除。列表顺序即 feed 板块顺序。
// 读-改-写用模块级串行 + atomicWrite（与其它 config 一致）。本层是唯一读 active-sources 处。
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR, atomicWrite } from "@/core/store/file";

export const ACTIVE_SOURCES_FILE = path.join(CONFIG_DIR, "active-sources.json");

/** 默认启用源（国内自用友好：GitHub 主源 + 掘金 + 博客园；HN 默认关） */
export const DEFAULT_ACTIVE_SOURCES = ["github", "juejin", "cnblogs"];

let writeChain: Promise<void> = Promise.resolve();

export async function readActiveSources(): Promise<string[]> {
  try {
    const obj = JSON.parse(await fs.readFile(ACTIVE_SOURCES_FILE, "utf-8")) as unknown;
    if (Array.isArray(obj)) {
      const list = obj.filter((x): x is string => typeof x === "string");
      return list.length > 0 ? list : [...DEFAULT_ACTIVE_SOURCES];
    }
  } catch {
    // 无文件/损坏 → 默认
  }
  return [...DEFAULT_ACTIVE_SOURCES];
}

/** 显式写入启用源列表（校验：去重、只保留已知源可通过外部校验；此处仅规范化为 string[]） */
export async function writeActiveSources(list: string[]): Promise<void> {
  const run = writeChain.then(async () => {
    const cleaned = [...new Set(list.filter((x) => typeof x === "string" && x.trim()))];
    await atomicWrite(ACTIVE_SOURCES_FILE, JSON.stringify(cleaned, null, 2) + "\n");
  });
  writeChain = run.catch(() => {});
  await run;
}
