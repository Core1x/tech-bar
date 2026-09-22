// AI 产物元数据的落盘读写（M0.2）。sidecar 方案：主文件旁挂 `<主文件>.meta.json`，
// 主文件保持纯内容（Markdown/JSON 原样），任何旧读取路径零影响；缺 sidecar 即 legacy。
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "@/core/store/file";
import type { ArtifactMeta } from "@/core/domain/artifact";

export function metaFileFor(mainFile: string): string {
  return `${mainFile}.meta.json`;
}

/** 读 sidecar；缺失/损坏/schemaVersion 不符 → null（按 legacy 处理） */
export async function readArtifactMeta(mainFile: string): Promise<ArtifactMeta | null> {
  try {
    const meta = JSON.parse(await fs.readFile(metaFileFor(mainFile), "utf-8")) as ArtifactMeta;
    return meta && meta.schemaVersion === 1 && typeof meta.sourceFingerprint === "string" ? meta : null;
  } catch {
    return null;
  }
}

/** 原子写主文件 + sidecar（写顺序：内容先、元数据后——宁可 legacy 也不出现"有 meta 无正文"） */
export async function writeArtifact(mainFile: string, content: string, meta: ArtifactMeta): Promise<void> {
  await atomicWrite(mainFile, content);
  await atomicWrite(metaFileFor(mainFile), JSON.stringify(meta, null, 2) + "\n");
}

export interface FoundArtifact {
  file: string;
  /** 文件 mtime（ISO）——legacy 无 meta 时兜底当"产出时间"用 */
  mtimeIso: string;
}

/**
 * 读取某产物的「当前有效版本」：优先指纹精确命中（exact=true），否则回退同前缀的最新旧版本
 * （供界面标 stale/legacy + 可重新生成，而不是当成未生成）。都没有 → null。
 */
export async function readVersionedArtifact(opts: {
  exactFile: string;
  dir: string;
  prefix: string;
  ext: string;
}): Promise<{ file: string; content: string; meta: ArtifactMeta | null; exact: boolean } | null> {
  try {
    const content = await fs.readFile(opts.exactFile, "utf-8");
    return { file: opts.exactFile, content, meta: await readArtifactMeta(opts.exactFile), exact: true };
  } catch {
    // 精确指纹未命中，找最新旧版本
  }
  const hits = await findArtifactsByPrefix(opts.dir, opts.prefix, opts.ext);
  for (const h of hits) {
    try {
      const content = await fs.readFile(h.file, "utf-8");
      return { file: h.file, content, meta: await readArtifactMeta(h.file), exact: false };
    } catch {
      // 竞态删除：继续找下一条
    }
  }
  return null;
}

/**
 * 前缀搜索产物（如 verdict 的 `{owner}__{name}__*.md`），按 mtime 新→旧。
 * 排除 sidecar；目录不存在 → 空数组。
 */
export async function findArtifactsByPrefix(dir: string, prefix: string, ext: string): Promise<FoundArtifact[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const hits: FoundArtifact[] = [];
  for (const f of entries) {
    if (!f.startsWith(prefix) || !f.endsWith(ext) || f.endsWith(".meta.json")) continue;
    try {
      const st = await fs.stat(path.join(dir, f));
      hits.push({ file: path.join(dir, f), mtimeIso: st.mtime.toISOString() });
    } catch {
      // 竞态删除：跳过
    }
  }
  hits.sort((a, b) => Date.parse(b.mtimeIso) - Date.parse(a.mtimeIso));
  return hits;
}
