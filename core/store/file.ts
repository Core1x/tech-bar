// data/ 目录读写工具：网站全部内容来源，服务端页面与 API 路由共用
// M1.3 由 lib/data.ts 整体迁入（逐字，零行为变化）；lib/data.ts 现为 re-export 垫片。
// ADR A6 待办：data 根目前仍 process.cwd()，M1.5 起由 createCore({ dataDir }) 注入后统一改此文件取参。
// 多源（M2+）：本文件读写的仍是顶层旧路径（data/latest.json、data/history/），
// 源分区（data/sources/{source}/）迁移在 Phase 2 做，届时加兼容垫片：读旧位置先于新分区。
import fs from 'fs/promises';
import path from 'path';
import type { HistoryEntry, HotLatest, LatestData, WatchlistEntry } from '@/core/domain/types';

export const DATA_DIR = path.join(process.cwd(), 'data');
export const HISTORY_DIR = path.join(DATA_DIR, 'history');
export const DIGESTS_DIR = path.join(DATA_DIR, 'digests');
export const CACHE_DIR = path.join(DATA_DIR, 'cache');
export const README_CACHE_DIR = path.join(CACHE_DIR, 'readme');
export const CONFIG_DIR = path.join(DATA_DIR, 'config');
/** AI 趋势周报目录（与 digests/ 平级独立，避免 listDigests 文件名解析冲突） */
export const RADAR_DIR = path.join(DATA_DIR, 'radar');
/** 每源分区目录（多源目标布局，见 docs/architecture.md §7）：data/sources/{source}/latest.json… */
export const SOURCES_DIR = path.join(DATA_DIR, 'sources');
/** 跨源 AI 综述产物目录（Phase 5；与 digests/ 平级独立，避开 listDigests 文件名解析） */
export const CROSS_DIGESTS_DIR = path.join(DATA_DIR, 'cross-digests');
/** HN 快照历史目录（Phase 5 为跨源周报提供逐日深度）：data/sources/hackernews/history/{date}.json */
export const HN_HISTORY_DIR = path.join(SOURCES_DIR, 'hackernews', 'history');
/** GitHub 热榜（存量榜 /hot 页）快照目录：data/hot/latest.json + data/hot/history/{date}.json */
export const HOT_DIR = path.join(DATA_DIR, 'hot');
export const HOT_HISTORY_DIR = path.join(HOT_DIR, 'history');
/** 热榜 README 探测缓存（repo → "y"|"n"；README 有无极少变化，探测一次长期复用，避免每日重复烧核心配额） */
export const HOT_README_CACHE_FILE = path.join(CACHE_DIR, 'hot-readme.json');
/** M1「今日必须看」简报产物缓存：data/cache/briefing/{date}.json（条目事实不复制，只存选择结果+解释） */
export const BRIEFING_DIR = path.join(CACHE_DIR, 'briefing');

export async function ensureDirs(): Promise<void> {
  await Promise.all([
    fs.mkdir(HISTORY_DIR, { recursive: true }),
    fs.mkdir(DIGESTS_DIR, { recursive: true }),
    fs.mkdir(RADAR_DIR, { recursive: true }),
    fs.mkdir(README_CACHE_DIR, { recursive: true }),
    fs.mkdir(CONFIG_DIR, { recursive: true }),
    fs.mkdir(SOURCES_DIR, { recursive: true }),
    fs.mkdir(CROSS_DIGESTS_DIR, { recursive: true }),
    fs.mkdir(HN_HISTORY_DIR, { recursive: true }),
    fs.mkdir(HOT_HISTORY_DIR, { recursive: true }),
    fs.mkdir(BRIEFING_DIR, { recursive: true }),
  ]);
}

/** GitHub 每日快照日期（YYYY-MM-DD），新→旧 */
export async function listGithubHistoryDates(): Promise<string[]> {
  try {
    return (await fs.readdir(HISTORY_DIR))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

/** 原子写文件:先写同目录 .tmp 再 rename,避免并发读(如页面请求)读到半写/截断内容 */
export async function atomicWrite(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data, 'utf-8');
  await fs.rename(tmp, file);
}

// ---------- 文件级读取缓存（性能） ----------
// 一次页面渲染会多处读同一份大 JSON（首页：buildFeed / 简报 / 异常变化各自 readLatest + 全部源快照；
// 雷达：逐日 history；日报页：全部 .md）。重复 read+parse 是服务端 TTFB 的主要开销。
// 策略：以 `mtimeMs|size` 为版本键的 memo——命中只做一次 stat（微秒级），文件未变绝不重复读/解析；
// 写入全走 atomicWrite（rename 必刷新 mtime），读侧永不拿旧值；多进程（CLI 更新子进程 vs web）同样成立。
// 上限 96 条按插入序逐出（latest/history/digest 总量远小于此，实为防御）。
interface FileCacheSlot {
  ver: string;
  text: string | null;
  json: unknown;
  jsonValid: boolean;
}
const fileCache = new Map<string, FileCacheSlot>();
const FILE_CACHE_MAX = 96;

/** 返回该文件的缓存槽（ver 变化时重读文本并作废 json）；stat 失败（无文件）→ null 不缓存 */
async function slotFor(file: string): Promise<FileCacheSlot | null> {
  let st;
  try {
    st = await fs.stat(file);
  } catch {
    return null;
  }
  const ver = `${st.mtimeMs}|${st.size}`;
  let slot = fileCache.get(file);
  if (!slot || slot.ver !== ver) {
    let text: string | null;
    try {
      text = await fs.readFile(file, "utf-8");
    } catch {
      text = null;
    }
    if (fileCache.size >= FILE_CACHE_MAX && !fileCache.has(file)) {
      const oldest = fileCache.keys().next().value;
      if (oldest !== undefined) fileCache.delete(oldest);
    }
    slot = { ver, text, json: undefined, jsonValid: false };
    fileCache.set(file, slot);
  }
  return slot;
}

/** 读文本文件（带缓存）；文件不存在 → null（缺失不缓存，避免创建瞬间竞态） */
async function readTextCached(file: string): Promise<string | null> {
  const slot = await slotFor(file);
  return slot?.text ?? null;
}

/** 读 JSON 并按槽缓存 parse 结果；损坏/缺失 → null；结构校验留给调用方 */
async function readJsonCached<T>(file: string): Promise<T | null> {
  const slot = await slotFor(file);
  if (!slot || slot.text === null) return null;
  if (!slot.jsonValid) {
    try {
      slot.json = JSON.parse(slot.text);
    } catch {
      slot.json = null;
    }
    slot.jsonValid = true;
  }
  return slot.json as T | null;
}

// ---------- latest.json ----------

export async function readLatest(): Promise<LatestData | null> {
  return readJsonCached<LatestData>(path.join(DATA_DIR, 'latest.json')); // 首次运行前无数据 → null
}

export async function writeLatest(data: LatestData): Promise<void> {
  await ensureDirs();
  await atomicWrite(path.join(DATA_DIR, 'latest.json'), JSON.stringify(data, null, 2));
}

// ---------- sources/{source}/latest.json（每源分区；GitHub 目前仍写旧顶层 latest.json，垫片语义见 M1.3） ----------

export function sourceLatestPath(source: string): string {
  return path.join(SOURCES_DIR, source, 'latest.json');
}

/** 读某源分区最新快照（无文件/损坏 → null）。结构由各源 adapter 定义（多源以 {source,fetched_at,items} 为约定起点） */
export async function readSourceLatest<T = unknown>(source: string): Promise<T | null> {
  return readJsonCached<T>(sourceLatestPath(source));
}

export async function writeSourceLatest<T>(source: string, data: T): Promise<void> {
  await ensureDirs();
  await atomicWrite(sourceLatestPath(source), JSON.stringify(data, null, 2));
}

// ---------- history/ ----------

export async function readHistory(date: string): Promise<HistoryEntry | null> {
  return readJsonCached<HistoryEntry>(path.join(HISTORY_DIR, `${date}.json`));
}

export async function writeHistory(entry: HistoryEntry): Promise<void> {
  await ensureDirs();
  await atomicWrite(path.join(HISTORY_DIR, `${entry.date}.json`), JSON.stringify(entry, null, 2));
}

/** 所有历史快照日期，升序（如 ['2026-08-19', '2026-08-20', '2026-08-21']） */
export async function listHistoryDates(): Promise<string[]> {
  try {
    const files = await fs.readdir(HISTORY_DIR);
    return files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort();
  } catch {
    return [];
  }
}

// ---------- config/tracked-repos.json ----------

export async function readTrackedRepos(): Promise<string[]> {
  try {
    const list = await readJsonCached<unknown>(path.join(CONFIG_DIR, 'tracked-repos.json'));
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export async function writeTrackedRepos(repos: string[]): Promise<void> {
  await ensureDirs();
  await atomicWrite(path.join(CONFIG_DIR, 'tracked-repos.json'), JSON.stringify(repos, null, 2));
}

// ---------- config/watchlist.json（跨源关注，Phase 4 聚合首页 —— architecture.md §4.10） ----------

export const WATCHLIST_FILE = path.join(CONFIG_DIR, 'watchlist.json');

/** watchlist 复合键：`${source}:${source_id}`（去重/匹配均用） */
export function watchlistKey(source: string, sourceId: string): string {
  return `${source}:${sourceId}`;
}

/** 读全部关注条目（无文件/损坏 → []） */
export async function readWatchlist(): Promise<WatchlistEntry[]> {
  try {
    const list = await readJsonCached<unknown>(WATCHLIST_FILE);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (e): e is WatchlistEntry =>
        !!e && typeof e === 'object' && typeof e.source === 'string' && typeof e.source_id === 'string',
    );
  } catch {
    return [];
  }
}

export async function writeWatchlist(list: WatchlistEntry[]): Promise<void> {
  await ensureDirs();
  await atomicWrite(WATCHLIST_FILE, JSON.stringify(list, null, 2));
}

// 读-改-写相互串行，避免并发开关（页面上快速点击 / 多标签）丢条目
let watchlistLock: Promise<void> = Promise.resolve();
function withWatchlistLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = watchlistLock.then(fn, fn);
  // 无论成功失败都释放锁，且不让上游拿到 reject 后的锁链
  watchlistLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * 切换关注：`{source, source_id}` 已关注 → 移除；未关注 → 追加（addedAt=now，可带展示快照）。
 * snapshot 由调用方从当前 FeedItem 捕获（title/url/description/lastMetricLabel/capturedAt），
 * 用于「条目离开今日榜单后关注页仍能解释关注的是什么」（M2 §8.4/§8.5）。缺省即旧行为。
 * 返回 { added: 该条目当前是否在清单, items: 全量清单 }。
 */
export async function toggleWatchlist(
  source: string,
  sourceId: string,
  snapshot?: WatchlistEntry["snapshot"],
): Promise<{ added: boolean; items: WatchlistEntry[] }> {
  return withWatchlistLock(async () => {
    const list = await readWatchlist();
    const key = watchlistKey(source, sourceId);
    const idx = list.findIndex((e) => watchlistKey(e.source, e.source_id) === key);
    if (idx >= 0) {
      list.splice(idx, 1);
      await writeWatchlist(list);
      return { added: false, items: list };
    }
    const entry: WatchlistEntry = { source, source_id: sourceId, addedAt: new Date().toISOString() };
    if (snapshot && typeof snapshot.title === "string") entry.snapshot = snapshot;
    list.push(entry);
    await writeWatchlist(list);
    return { added: true, items: list };
  });
}

// ---------- cache/summaries.json ----------

export async function readSummaries(): Promise<Record<string, string>> {
  const obj = await readJsonCached<unknown>(path.join(CACHE_DIR, 'summaries.json'));
  return obj && typeof obj === 'object' ? (obj as Record<string, string>) : {};
}

export async function writeSummaries(map: Record<string, string>): Promise<void> {
  await ensureDirs();
  await atomicWrite(path.join(CACHE_DIR, 'summaries.json'), JSON.stringify(map, null, 2));
}

// ---------- cache/readme/ ----------

export function readmeCachePath(owner: string, name: string, filePath = ""): string {
  return path.join(README_CACHE_DIR, readmeCacheKey(owner, name, filePath));
}

/** 文件缓存键：默认 README = owner__name.md；仓库内子路径 → owner__name__<段安全化>.md，避免撞名 */
function readmeCacheKey(owner: string, name: string, filePath: string): string {
  const suffix = filePath
    ? "__" + filePath.split(/[/\\]+/).filter(Boolean).map((s) => s.replace(/[^\w.-]/g, "_")).join("__")
    : "";
  return `${owner}__${name}${suffix}.md`;
}

export async function readReadmeCache(owner: string, name: string, filePath = ""): Promise<string | null> {
  return readTextCached(readmeCachePath(owner, name, filePath));
}

export async function writeReadmeCache(owner: string, name: string, content: string, filePath = ""): Promise<void> {
  await ensureDirs();
  await atomicWrite(readmeCachePath(owner, name, filePath), content);
}

// ---------- cache/star-history.json ----------
// star 趋势索引（update-trending.mjs 维护），详情页读它避免全量扫 history/ 快照

export const STAR_HISTORY_FILE = path.join(CACHE_DIR, 'star-history.json');

export interface StarIndexPoint {
  date: string;
  stars: number;
}

export interface StarHistoryIndex {
  meta: { latestDate: string };
  repos: Record<string, StarIndexPoint[]>;
}

export async function readStarHistoryIndex(): Promise<StarHistoryIndex | null> {
  try {
    const obj = await readJsonCached<Partial<StarHistoryIndex>>(STAR_HISTORY_FILE);
    if (
      obj &&
      typeof obj === 'object' &&
      obj.repos &&
      typeof obj.repos === 'object' &&
      typeof obj.meta?.latestDate === 'string'
    ) {
      return { meta: obj.meta as StarHistoryIndex['meta'], repos: obj.repos as StarHistoryIndex['repos'] };
    }
    return null;
  } catch {
    return null;
  }
}

/** 从 history/*.json 全量重建 star 历史索引（索引缺失/落后于最新快照时的兜底，一次性成本） */
export async function rebuildStarHistoryIndex(): Promise<StarHistoryIndex> {
  const dates = await listHistoryDates();
  const repos: Record<string, StarIndexPoint[]> = {};
  for (const d of dates) {
    const h = await readHistory(d);
    if (!h) continue;
    for (const r of h.repos) {
      (repos[r.full_name] ??= []).push({ date: d, stars: r.stars });
    }
  }
  const index: StarHistoryIndex = { meta: { latestDate: dates[dates.length - 1] ?? '' }, repos };
  await atomicWrite(STAR_HISTORY_FILE, JSON.stringify(index, null, 2));
  return index;
}

// ---------- digests/ ----------

export interface DigestMeta {
  date: string; // 从文件名解析
  filename: string;
  title: string; // 首行 # 标题，无则截取正文
  content: string;
}

/** 全部洞察文章（按日期倒序），含正文 */
export async function listDigests(): Promise<DigestMeta[]> {
  try {
    const files = await fs.readdir(DIGESTS_DIR);
    const mds = files.filter((f) => /^\d{4}-\d{2}-\d{2}(-[\w-]+)?\.md$/.test(f)).sort().reverse();
    const out: DigestMeta[] = [];
    for (const f of mds) {
      const content = (await readTextCached(path.join(DIGESTS_DIR, f))) ?? "";
      const date = f.slice(0, 10);
      const title = extractTitle(content) || `${date} 每日洞察`;
      out.push({ date, filename: f, title, content });
    }
    return out;
  } catch {
    return [];
  }
}

/** 全部趋势周报（按日期倒序），含正文 —— 目录 data/radar/{YYYY-MM-DD}.md */
export async function listRadars(): Promise<DigestMeta[]> {
  try {
    const files = await fs.readdir(RADAR_DIR);
    const mds = files.filter((f) => /^\d{4}-\d{2}-\d{2}(-[\w-]+)?\.md$/.test(f)).sort().reverse();
    const out: DigestMeta[] = [];
    for (const f of mds) {
      const content = (await readTextCached(path.join(RADAR_DIR, f))) ?? "";
      const date = f.slice(0, 10);
      const title = extractTitle(content) || `${date} 趋势周报`;
      out.push({ date, filename: f, title, content });
    }
    return out;
  } catch {
    return [];
  }
}

function extractTitle(content: string): string {
  const firstLine = content.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (firstLine && firstLine.startsWith('# ')) return firstLine.replace(/^#\s+/, '');
  return firstLine ? firstLine.slice(0, 60) : '';
}

// ---------- cross-digests/（跨源 AI 综述产物，Phase 5） ----------

/** 读某日跨源综述产物（无 → null） */
export async function readCrossDigest(date: string): Promise<string | null> {
  return readTextCached(path.join(CROSS_DIGESTS_DIR, `${date}.md`));
}

export async function writeCrossDigest(date: string, content: string): Promise<void> {
  await ensureDirs();
  await atomicWrite(path.join(CROSS_DIGESTS_DIR, `${date}.md`), content);
}

/** 全部跨源综述（按日期倒序），含正文 */
export async function listCrossDigests(): Promise<DigestMeta[]> {
  try {
    const files = await fs.readdir(CROSS_DIGESTS_DIR);
    const mds = files.filter((f) => /^\d{4}-\d{2}-\d{2}(-[\w-]+)?\.md$/.test(f)).sort().reverse();
    const out: DigestMeta[] = [];
    for (const f of mds) {
      const content = (await readTextCached(path.join(CROSS_DIGESTS_DIR, f))) ?? "";
      const date = f.slice(0, 10);
      out.push({ date, filename: f, title: extractTitle(content) || `${date} 跨源综述`, content });
    }
    return out;
  } catch {
    return [];
  }
}

// ---------- sources/hackernews/history/{date}.json（HN 快照历史，Phase 5） ----------

export interface HnHistoryEntry {
  date: string;
  fetched_at: string;
  items: unknown[]; // SourceItem[]（写时进入，读者按需断言）
}

export function hnHistoryPath(date: string): string {
  return path.join(HN_HISTORY_DIR, `${date}.json`);
}

export async function readHnHistory(date: string): Promise<HnHistoryEntry | null> {
  return readJsonCached<HnHistoryEntry>(hnHistoryPath(date));
}

export async function writeHnHistory(entry: HnHistoryEntry): Promise<void> {
  await ensureDirs();
  await atomicWrite(hnHistoryPath(entry.date), JSON.stringify(entry, null, 2));
}

/** HN 快照历史全部日期，升序（如 ['2026-09-08', …]） */
export async function listHnDates(): Promise<string[]> {
  try {
    const files = await fs.readdir(HN_HISTORY_DIR);
    return files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort();
  } catch {
    return [];
  }
}

// ---------- hot/（GitHub 热榜存量快照：latest + 逐日 history，结构同 LatestData 惯例） ----------

export async function readHotLatest(): Promise<HotLatest | null> {
  return readJsonCached<HotLatest>(path.join(HOT_DIR, 'latest.json')); // 首次生成前无数据 → null
}

/** 写热榜快照：latest.json 覆盖 + 同日 history 覆盖（重跑幂等） */
export async function writeHotLatest(data: HotLatest): Promise<void> {
  await ensureDirs();
  const json = JSON.stringify(data, null, 2);
  await atomicWrite(path.join(HOT_DIR, 'latest.json'), json);
  await atomicWrite(path.join(HOT_HISTORY_DIR, `${data.date}.json`), json);
}

/** 读某日热榜历史快照（无 → null） */
export async function readHotHistory(date: string): Promise<HotLatest | null> {
  return readJsonCached<HotLatest>(path.join(HOT_HISTORY_DIR, `${date}.json`));
}

/** 热榜历史全部日期，升序 */
export async function listHotDates(): Promise<string[]> {
  try {
    const files = await fs.readdir(HOT_HISTORY_DIR);
    return files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort();
  } catch {
    return [];
  }
}

/** README 探测缓存（读损坏/无 → {}；写走 atomicWrite） */
export async function readHotReadmeCache(): Promise<Record<string, string>> {
  const obj = await readJsonCached<unknown>(HOT_README_CACHE_FILE);
  return obj && typeof obj === 'object' ? (obj as Record<string, string>) : {};
}

export async function writeHotReadmeCache(map: Record<string, string>): Promise<void> {
  await ensureDirs();
  await atomicWrite(HOT_README_CACHE_FILE, JSON.stringify(map, null, 2));
}
