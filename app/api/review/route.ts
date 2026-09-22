// GET /api/review?repo=owner/name — AI 项目总结与评测（带磁盘缓存）
// 命中缓存 → 直接返回；未命中 → 基于当日真实数据调 AI 生成 → 写缓存（data/cache/reviews/）
// 无 AI key → 503；仓库不在今日数据中 → 404
// M0.2（产物新鲜度）：
//   - 旧缺陷「只按仓库名保存、永不失效」：文件名不变（兼容既有缓存），新增 `.meta.json` sidecar
//     记录来源指纹；peek 命中但指纹 ≠ 当前输入 → {freshness:"stale"} + 旧正文（界面可重新生成）；
//     无 sidecar 的旧缓存 → "legacy"（历史缓存·依据时间未知）。
//   - 正文引用 star/近日增量 → 这些字段必须进入指纹：喂给模型的即是 2 位有效数字的量级值
//     （如"约 23 万"），指纹取量级桶；日内小幅漂移不误判过期，量级/描述/维护变化则过期。
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { readLatest } from "@/lib/data";
import { getRepo } from "@/lib/github";
import { completeChat, hasDeepSeekKey } from "@/lib/deepseek";
import { resolveAiConfig } from "@/lib/ai-config";
import { coarseBucket, fingerprintOf, freshnessOf, type ArtifactMeta } from "@/core/domain/artifact";
import { readArtifactMeta, writeArtifact } from "@/core/store/artifact";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REVIEW_DIR = path.join(process.cwd(), "data", "cache", "reviews");

/** 取仓库信息 + 其依据数据的更新时间（今日池→快照 updated_at；实时拉取→拉取时刻） */
async function findRepoInfo(fullName: string): Promise<{ info: RepoForReview; sourceUpdatedAt: string } | null> {
  const latest = await readLatest();
  const fromToday =
    latest?.new_stars.find((r) => r.full_name === fullName) ??
    latest?.tracked.find((r) => r.full_name === fullName);
  if (fromToday) {
    return { info: fromToday as RepoForReview, sourceUpdatedAt: latest?.updated_at ?? new Date().toISOString() };
  }

  const [owner, name] = fullName.split("/");
  // 瞬时网络错误重试一次，仍失败返回 null（AI 评测不阻塞页面）
  let gh = null;
  for (let attempt = 0; attempt < 2 && !gh; attempt++) {
    try {
      gh = await getRepo(owner, name);
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  if (!gh?.data) return null;
  return {
    info: {
      full_name: gh.data.full_name,
      summary: null,
      description: gh.data.description,
      language: gh.data.language,
      stars: gh.data.stargazers_count,
      delta_1d: null,
      created_at: gh.data.created_at?.slice(0, 10),
      topics: gh.data.topics ?? [],
    },
    sourceUpdatedAt: new Date().toISOString(),
  };
}

interface RepoForReview {
  full_name: string;
  description: string | null;
  summary?: string | null;
  language: string | null;
  stars: number;
  delta_1d?: number | null;
  created_at?: string | null;
  topics?: string[];
}

/** 缓存指纹 = 实际进入请求的数据：文本输入 + 量级化后的 star/增量（正文只可能被要求引用量级值） */
function fingerprint(info: RepoForReview): string {
  return fingerprintOf({
    desc: info.summary || info.description || "",
    lang: info.language ?? null,
    created: info.created_at ?? "",
    topics: [...(info.topics ?? [])].sort(),
    starsBucket: coarseBucket(info.stars),
    deltaBucket: coarseBucket(info.delta_1d ?? null),
  });
}

function buildPrompt(info: RepoForReview, date: string): string {
  const desc = info.summary || info.description || "（无描述）";
  const delta = info.delta_1d;
  const topics = (info.topics ?? []).join("、") || "无";
  const created = info.created_at ?? "未知";
  const lang = info.language ?? "未知";
  const starsApprox = coarseBucket(info.stars);
  const deltaApprox = delta === null || delta === undefined ? "—" : `+${coarseBucket(delta)}`;
  return `你是开源项目评测专家。请基于以下真实数据，为这个 GitHub 项目写一份简明的中文评测（200-300 字），用 Markdown 输出，结构如下（严格遵守）：

**一句话总结**：（一句话概括这个项目是做什么的）

**亮点**：
- （3-5 条，基于数据如实描述）

**适合谁**：
（一段话，说明适合什么人群/场景使用）

**注意事项**：
（一段话，基于数据的局限、竞争或风险如实说明；数据里没有的信息不要编造）

数字纪律：正文引用热度时只可用下方给定的约数（约 ${starsApprox} star），不要写出精确数字，也不要推断未给出的指标。

项目信息（数据日期 ${date}）：
- 名称：${info.full_name}
- 描述：${desc}
- 语言：${lang} | star 约数：${starsApprox} | 近日新增约：${deltaApprox} | 创建于：${created}
- 话题：${topics}`;
}

function respond(content: string, meta: ArtifactMeta | null, fp: string, extra?: Record<string, unknown>): Response {
  return Response.json({ cached: true, freshness: freshnessOf(meta, fp), content, meta, ...extra });
}

export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get("repo") ?? "";
  if (!REPO_PATTERN.test(repo)) {
    return Response.json({ error: "repo 参数不合法，格式应为 owner/name" }, { status: 400 });
  }
  const [owner, name] = repo.split("/");
  const fullName = `${owner}/${name}`;
  // peek=1：只查缓存，未命中不调用 AI（前端给"生成"按钮，token 可控）
  const peek = req.nextUrl.searchParams.get("peek") === "1";

  const found0 = await findRepoInfo(fullName);
  if (!found0) {
    return Response.json(
      { error: "仓库信息获取失败（不在今日榜单，且实时拉取失败或仓库不存在）" },
      { status: 404 },
    );
  }
  const { info, sourceUpdatedAt } = found0;

  // 1. 读磁盘缓存（文件名仍按仓库名，兼容旧缓存；新鲜度由 sidecar 指纹判定）
  const cacheFile = path.join(REVIEW_DIR, `${owner}__${name}.md`);
  let cachedContent: string | null = null;
  let cachedMeta: ArtifactMeta | null = null;
  try {
    cachedContent = await fs.readFile(cacheFile, "utf-8");
    cachedMeta = await readArtifactMeta(cacheFile);
  } catch {
    // 未命中
  }
  const fp = fingerprint(info);
  const freshness = cachedContent !== null ? freshnessOf(cachedMeta, fp) : null;

  // 1.5 peek：有正文就带回（含 stale/legacy，界面据此显示旧内容+重新生成入口）
  if (peek) {
    if (cachedContent !== null) return respond(cachedContent, cachedMeta, fp);
    return Response.json({ cached: false, available: false });
  }
  // 非 peek 且已是最新数据 → 直接返回（不重复烧 token；stale/legacy 落下去重新生成）
  if (cachedContent !== null && freshness === "fresh") {
    return respond(cachedContent, cachedMeta, fp);
  }

  // 2. 无 key → 有旧正文带 genError 返回，否则 503（前端显示友好提示，不阻塞页面）
  const hasKey = await hasDeepSeekKey();
  if (!hasKey) {
    const msg = "未配置 AI 接入，无法生成评测（可在「设置」页填写）";
    if (cachedContent !== null) return respond(cachedContent, cachedMeta, fp, { genError: msg });
    return Response.json({ error: msg }, { status: 503 });
  }

  // 3. 生成并原子写（内容 + meta sidecar；失败保留旧文件）
  try {
    const content = await completeChat([{ role: "user", content: buildPrompt(info, new Date().toISOString().slice(0, 10)) }], {
      signal: AbortSignal.timeout(90_000),
      // 关思考提速（同跨源综述口径；端点不认自动降级），README 解析类输出无需深度推理
      disableThinking: true,
      reasoningEffort: "low",
    });
    const meta: ArtifactMeta = {
      schemaVersion: 1,
      kind: "review",
      generatedAt: new Date().toISOString(),
      sourceDate: new Date().toISOString().slice(0, 10),
      sourceUpdatedAt,
      sourceFingerprint: fp,
      model: (await resolveAiConfig()).model,
    };
    await writeArtifact(cacheFile, content, meta);
    return Response.json({ cached: false, freshness: "fresh", content, meta });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 502;
    const msg = status === 503 ? "未配置 AI 接入，无法生成评测" : `AI 生成失败：${(err as Error).message}`;
    if (cachedContent !== null) return respond(cachedContent, cachedMeta, fp, { genError: msg });
    return Response.json({ error: msg }, { status });
  }
}
