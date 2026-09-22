// /api/compare —— M3 项目对比（§9.5）。
// GET ?repos=a/b,c/d[,e/f,g/h]：事实矩阵（≤4 个 GitHub 仓库）——全部确定性字段，零 AI 可用：
//   定位（中文摘要/描述）、star 与近 7 日增长（明确起止日期）、fork、open issues、最后推送、
//   许可证、语言、创建时间、最新 release、归档/维护风险、README 部署线索（读缓存，缺缓存不现拉）。
// POST {repos, scenario}：用户一句话场景 → AI 在矩阵之下写「按该场景如何选择」，只许引用矩阵字段。
// 数据源：live getRepo（每仓 1 请求）+ releases/latest（可选 1 次，失败降级）+ 本站 star-history + 摘要缓存。
import { NextRequest } from "next/server";
import { getRepo, ghGetJson } from "@/lib/github";
import { completeChat, hasDeepSeekKey } from "@/lib/deepseek";
import { readLatest, readSummaries, readStarHistoryIndex, readReadmeCache } from "@/lib/data";
import { summaryKey } from "@/core/domain/summary";
import { readmeDigest } from "@/core/domain/decision";
import type { CompareRepoData } from "@/core/domain/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_REPOS = 4;

function lastPushDays(pushedAt: string | null): number | null {
  if (!pushedAt) return null;
  const t = Date.parse(pushedAt.length === 10 ? pushedAt + "T23:59:59Z" : pushedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/** 近 7 日增长：star-history 索引里最后一个点 vs ≤8 天前最接近的点（本站快照口径，起止日期明确） */
async function weekGrowth(fullName: string): Promise<CompareRepoData["growth7d"]> {
  try {
    const idx = await readStarHistoryIndex();
    const points = idx?.repos[fullName] ?? [];
    if (points.length < 2) {
      return points.length === 1 ? null : null;
    }
    const last = points[points.length - 1];
    const cutoff = Date.parse(last.date) - 8 * 86_400_000;
    let base = points[0];
    for (const p of points) {
      if (Date.parse(p.date) >= cutoff) {
        base = p;
        break;
      }
    }
    if (base.date === last.date) return null;
    const spanDays = Math.round((Date.parse(last.date) - Date.parse(base.date)) / 86_400_000);
    return { from: base.date, to: last.date, delta: last.stars - base.stars, note: spanDays < 7 ? `样本 ${spanDays} 天（不足 7 日，口径为本站快照区间）` : undefined };
  } catch {
    return null;
  }
}

/** 与超时赛跑（api.github.com 偶发挂连接：不超时会把整个矩阵拖死；超时该仓按获取失败降级） */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

async function oneRepo(fullName: string, summaries: Record<string, string>): Promise<CompareRepoData | null> {
  const [owner, name] = fullName.split("/");
  // 单仓任何请求异常只让该仓缺席，不炸整张矩阵（并发突发请求下 api.github.com 可能重置/挂起）
  const [gh, release] = await Promise.all([
    withTimeout(getRepo(owner, name).catch(() => null), 9000),
    (async () => {
      try {
        const r = await withTimeout(
          ghGetJson<{ tag_name?: string; published_at?: string }>(`/repos/${owner}/${name}/releases/latest`),
          8000,
        );
        if (!r || r.status !== 200 || !r.data?.tag_name) return null;
        return { tag: r.data.tag_name, publishedAt: r.data.published_at?.slice(0, 10) ?? null };
      } catch {
        return null;
      }
    })(),
  ]);
  if (!gh?.data) return null;
  const latest = await readLatest();
  const poolRow =
    latest?.trending?.find((r) => r.full_name === fullName) ??
    latest?.new_stars.find((r) => r.full_name === fullName) ??
    latest?.tracked.find((r) => r.full_name === fullName) ??
    null;
  const deltaToday =
    poolRow && "stars_today" in poolRow
      ? (poolRow as { stars_today?: number }).stars_today ?? null
      : poolRow && "delta_1d" in poolRow
        ? (poolRow as { delta_1d?: number | null }).delta_1d ?? null
        : null;
  const summary = summaries[summaryKey(fullName, gh.data.description ?? "")] ?? null;
  // README 部署线索：只读缓存（对比是浏览期高频操作，不为它现拉 4 份 README；详情页/决策访问过即有）
  const readmeCached = await readReadmeCache(owner, name);
  const deploy = readmeCached ? readmeDigest(readmeCached).deploy.slice(0, 2) : [];
  const days = lastPushDays((gh.data.pushed_at ?? "").slice(0, 10) || null);
  const license = gh.data.license === undefined ? null : gh.data.license === null ? "" : gh.data.license.spdx_id ?? "";
  const risks: string[] = [];
  if (gh.data.archived) risks.push("已归档");
  if (days !== null && days > 365) risks.push("超 1 年未推送");
  else if (days !== null && days >= 180) risks.push("更新放缓");
  if (license === "" || license === "NOASSERTION") risks.push("无明确许可证");
  const growth7d = await weekGrowth(fullName);
  if (growth7d === null) risks.push("趋势样本不足");
  return {
    fullName,
    positioning: summary || gh.data.description || null,
    language: gh.data.language ?? null,
    license: license === "" ? null : license,
    licenseKnown: gh.data.license !== undefined,
    archived: gh.data.archived === true,
    stars: gh.data.stargazers_count,
    deltaToday,
    growth7d,
    forks: gh.data.forks_count ?? null,
    openIssues: gh.data.open_issues_count ?? null,
    pushedAt: (gh.data.pushed_at ?? "").slice(0, 10) || null,
    lastPushDays: days,
    createdAt: gh.data.created_at?.slice(0, 10) ?? null,
    latestRelease: release,
    deployHints: deploy,
    risks,
  };
}

function parseRepos(raw: string | null | undefined): string[] | null {
  const list = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_REPOS);
  if (list.length < 2 || list.some((r) => !REPO_PATTERN.test(r))) return null;
  return [...new Set(list)];
}

export async function GET(req: NextRequest) {
  const repos = parseRepos(req.nextUrl.searchParams.get("repos"));
  if (!repos) return Response.json({ error: "repos 参数需为 2-4 个 owner/name（逗号分隔）" }, { status: 400 });
  const summaries = await readSummaries();
  const rows = await Promise.all(repos.map((r) => oneRepo(r, summaries)));
  const data = rows.filter((r): r is CompareRepoData => r !== null);
  if (data.length < 2) {
    return Response.json({ error: "仓库信息获取失败（GitHub 限流或不存在），请稍后重试" }, { status: 502 });
  }
  return Response.json({ ok: true, repos: data, fetchedAt: new Date().toISOString() });
}

/** 场景选择建议：AI 只许引用矩阵字段；输出纯文本（渲染为段落，不解析结构） */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const { scenario, repos } = (body ?? {}) as { scenario?: unknown; repos?: unknown };
  if (typeof scenario !== "string" || scenario.trim() === "" || scenario.length > 300) {
    return Response.json({ error: "请先用一句话描述你的使用场景（≤300 字）" }, { status: 400 });
  }
  const list = Array.isArray(repos) ? repos.filter((r): r is string => typeof r === "string") : [];
  if (list.length < 2 || list.length > MAX_REPOS || list.some((r) => !REPO_PATTERN.test(r))) {
    return Response.json({ error: "repos 需为 2-4 个 owner/name" }, { status: 400 });
  }
  if (!(await hasDeepSeekKey())) {
    return Response.json({ error: "未配置 AI 接入，无法生成选择建议（事实矩阵本身不需要 AI，可直接对比）" }, { status: 503 });
  }
  const summaries = await readSummaries();
  const rows = (await Promise.all(list.map((r) => oneRepo(r, summaries)))).filter((r): r is CompareRepoData => r !== null);
  if (rows.length < 2) return Response.json({ error: "仓库数据获取失败，无法给出建议" }, { status: 502 });
  const matrix = rows
    .map(
      (r) =>
        `- ${r.fullName}｜定位：${r.positioning ?? "无描述"}｜语言：${r.language ?? "未知"}｜star：${r.stars.toLocaleString("en-US")}${r.deltaToday ? `（今日 +${r.deltaToday.toLocaleString("en-US")}）` : ""}${r.growth7d ? `｜${r.growth7d.from}→${r.growth7d.to} 增长 ${r.growth7d.delta?.toLocaleString("en-US")}` : ""}｜fork：${r.forks ?? "—"}｜open issues：${r.openIssues ?? "—"}｜许可证：${r.licenseKnown ? r.license || "无明确" : "未知"}｜最后推送：${r.pushedAt ?? "未知"}｜创建：${r.createdAt ?? "未知"}｜release：${r.latestRelease ? r.latestRelease.tag : "未见"}｜风险：${r.risks.join("、") || "无"}｜部署线索：${r.deployHints.join(" ") || "README 未提供/未缓存"}`,
    )
    .join("\n");
  const prompt = `你是开源选型顾问。用户的场景：「${scenario.trim()}」。\n下面是候选仓库的事实矩阵（数据真实，含缺失口径）。用简体中文写一段「按该场景如何选择」的建议（120-200 字，纯文本，不用 Markdown 标题），要求：\n- 第一步先比「项目定位」与用户场景是否对口：定位与场景明显不相关的仓库不得作为推荐，若全部不对口要直说；\n- 结论先行：对口者之间再按许可、维护、部署方式、风险给"首先/其次选哪个、什么情况下换另一个"；\n- 只引用矩阵中给出的字段，不得虚构代码质量/性能/社区等矩阵没有的信息；\n- 矩阵里缺失的（如趋势样本不足、许可证未知）要提醒用户无法据此判断。\n\n事实矩阵：\n${matrix}`;
  try {
    const text = await completeChat([{ role: "user", content: prompt }], {
      signal: AbortSignal.timeout(60_000),
      disableThinking: true,
      reasoningEffort: "low",
      maxTokens: 600,
      temperature: 0.4,
    });
    return Response.json({ ok: true, advice: text.trim(), repos: rows.map((r) => r.fullName) });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 502;
    return Response.json({ error: status === 503 ? "未配置 AI 接入" : `AI 生成失败：${(err as Error).message}` }, { status });
  }
}
