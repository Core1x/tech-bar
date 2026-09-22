// GET /api/verdict?repo=owner/name — AI「判读」：这个仓库现在值不值得花时间，有什么坑。
// 与 /api/review 的区别与改进：
//   1. 输入给模型的是「确定性信号」+ 原始即时字段（pushed_at/archived/license），强制可溯源、禁止编造；
//   2. 缓存文件名带信号指纹（sha1），信号一变自动刷新——规避 review 缓存"只按仓库名、永不失效"的问题；
//   3. 写缓存用 atomicWrite（原子写）。
// M0.2（产物新鲜度）：
//   - 判读正文刻意不引用 star/增量/话题（每日漂移的运营指标），指纹只含正文真正依据的长寿命字段
//     （描述/摘要/维护/许可/创建/语言）——改维护、许可或描述即可判 stale；
//   - 命中同前缀旧版本（指纹已变）不再当成"未生成"，返回 {freshness:"stale"} + 旧正文，界面标
//     「数据已更新 · 可重新生成」；缺 meta sidecar 的旧缓存按 "legacy"（历史缓存·依据时间未知）；
//   - 重新生成失败时保留旧正文并在响应带 genError（界面"保留旧内容并展示错误"）。
import { NextRequest } from "next/server";
import path from "node:path";
import { readLatest } from "@/lib/data";
import { getRepo } from "@/lib/github";
import { completeChat, hasDeepSeekKey } from "@/lib/deepseek";
import { computeSignals } from "@/lib/signals";
import { resolveAiConfig } from "@/lib/ai-config";
import { fingerprintOf, freshnessOf, type ArtifactMeta } from "@/core/domain/artifact";
import { readVersionedArtifact, writeArtifact } from "@/core/store/artifact";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const VERDICT_DIR = path.join(process.cwd(), "data", "cache", "verdicts");

/** 判读所需的仓库信息（结构化字段 + 原始即时信号） */
interface RepoForVerdict {
  full_name: string;
  description: string | null;
  summary?: string | null;
  language: string | null;
  created_at?: string | null;
  pushed_at?: string | null;
  archived?: boolean | null;
  license?: string | null;
}

/** 取仓库信息 + 其依据数据的更新时间（今日池→快照 updated_at；实时拉取→拉取时刻） */
async function findRepoInfo(
  fullName: string,
): Promise<{ info: RepoForVerdict; sourceUpdatedAt: string } | null> {
  const latest = await readLatest();
  const fromToday =
    latest?.new_stars.find((r) => r.full_name === fullName) ??
    latest?.tracked.find((r) => r.full_name === fullName);
  if (fromToday) {
    // 显式挑字段：判读不喂 star/增量/话题（每日漂移指标，正文不引用 → 指纹排除）
    const info: RepoForVerdict = {
      full_name: fromToday.full_name,
      description: fromToday.description ?? null,
      summary: fromToday.summary ?? null,
      language: fromToday.language ?? null,
      created_at: fromToday.created_at ?? null,
      pushed_at: fromToday.pushed_at ?? null,
      archived: fromToday.archived ?? null,
      license: fromToday.license ?? null,
    };
    return { info, sourceUpdatedAt: latest?.updated_at ?? new Date().toISOString() };
  }

  const [owner, name] = fullName.split("/");
  let gh = null;
  for (let attempt = 0; attempt < 2 && !gh; attempt++) {
    try {
      gh = await getRepo(owner, name);
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  if (!gh?.data) return null;
  const fetchedAt = new Date().toISOString();
  return {
    info: {
      full_name: gh.data.full_name,
      description: gh.data.description,
      language: gh.data.language,
      created_at: gh.data.created_at?.slice(0, 10),
      pushed_at: (gh.data.pushed_at ?? "").slice(0, 10) || null,
      archived: gh.data.archived ?? false,
      license: gh.data.license?.spdx_id ?? null,
    },
    sourceUpdatedAt: fetchedAt,
  };
}

/**
 * 缓存指纹：只对「正文实际引用的长寿命/身份信号」取哈希。
 * 刻意排除 star/delta/topics——判读提示词已不再提供这些每日漂移的运营指标，正文不会引用旧值。
 */
function fingerprint(info: RepoForVerdict): string {
  return fingerprintOf({
    archived: info.archived ?? false,
    license: info.license ?? null,
    pushed_at: info.pushed_at ?? null,
    created_at: info.created_at ?? "",
    description: info.description ?? "",
    summary: info.summary ?? "",
    language: info.language ?? null,
  });
}

function buildPrompt(info: RepoForVerdict, date: string): string {
  const desc = info.summary || info.description || "（无描述）";
  const lang = info.language ?? "未知";
  const created = info.created_at ?? "未知";
  const signals = computeSignals(info);
  const chipsText =
    signals.chips.length > 0
      ? signals.chips.map((c) => `${c.label}（${c.detail}）`).join("；")
      : "无硬信号（本判读未见红旗；不代表无风险）";
  const archText = info.archived === undefined ? "未提供" : String(info.archived);
  const licText =
    info.license === undefined
      ? "未提供"
      : info.license === null || info.license === ""
        ? "无"
        : info.license;
  const pushText = info.pushed_at ? info.pushed_at : "未提供";
  return `你是开源仓库的独立「判读」评审，帮用户快速判断：这个仓库现在还值不值得花时间研究或试用，以及有没有明显的坑。
只依据下方「可公开核实的即时信号」作答，不要凭印象补充。请用简体中文 Markdown 输出，严格只有两节：

**判读**：一句话给倾向（如「值得关注」「可以试试，但注意 X」「不建议投入」「已停更，仅作参考」），并补一句理由。

**依据与风险**：
- 2-4 条要点，逐条引用下方信号本身（如「距上次推送约 N 天」「已归档」「无开源许可证」）。
- 只允许引用已给出的信号；未给出的（功能细节、代码质量、社区活跃度、作者意图、star 数与近日增量等运营指标一律未提供）不得编造，确需涉及就写「该信号未提供，无法判断」。

仓库：${info.full_name}
信号（数据日期 ${date}）：
- 一句话简介：${desc}
- 语言：${lang}｜创建于：${created}
- 维护/许可信号：${chipsText}
- 原始：archived=${archText}，license=${licText}，pushed_at=${pushText}`;
}

function respond(
  found: { content: string; meta: ArtifactMeta | null } | null,
  fp: string,
  extra?: Record<string, unknown>,
): Response {
  if (found) {
    return Response.json({
      cached: true,
      freshness: freshnessOf(found.meta, fp),
      content: found.content,
      meta: found.meta,
      ...extra,
    });
  }
  return Response.json({ cached: false, available: false, ...extra });
}

export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get("repo") ?? "";
  if (!REPO_PATTERN.test(repo)) {
    return Response.json({ error: "repo 参数不合法，格式应为 owner/name" }, { status: 400 });
  }
  const [owner, name] = repo.split("/");
  const fullName = `${owner}/${name}`;
  // peek=1：只查缓存，未命中不调用 AI（由前端给出"生成"按钮，让 token 可控）
  const peek = req.nextUrl.searchParams.get("peek") === "1";

  const found0 = await findRepoInfo(fullName);
  if (!found0) {
    return Response.json(
      { error: "仓库信息获取失败（不在今日榜单，且实时拉取失败或仓库不存在）" },
      { status: 404 },
    );
  }
  const { info, sourceUpdatedAt } = found0;
  const fp = fingerprint(info);
  const exactFile = path.join(VERDICT_DIR, `${owner}__${name}__${fp}.md`);

  // 1. 读产物：优先当前指纹精确命中，其次同仓库最新旧版本（stale/legacy 要展示旧正文，而非报"未生成"）
  const found = await readVersionedArtifact({
    exactFile,
    dir: VERDICT_DIR,
    prefix: `${owner}__${name}__`,
    ext: ".md",
  });
  const freshness = found ? freshnessOf(found.meta, fp) : null;

  // 1.5 peek：只要有任何正文（fresh/stale/legacy）都原样带回 + 状态，前端据此显示旧内容或给生成按钮；
  //     非 peek：已是最新 → 直接返回（不重复烧 token）；stale/legacy/缺失 → 落到下面真正生成。
  if (found && (peek || freshness === "fresh")) {
    return respond(found, fp);
  }
  if (peek) {
    return respond(null, fp);
  }

  // 2. 无 key：有旧正文就带旧正文 + genError；彻底没有 → 503 友好文案（前端显示"未接入 AI"）
  const hasKey = await hasDeepSeekKey();
  if (!hasKey) {
    const msg = "未配置 AI 接入，无法生成判读（可在「设置」页填写）";
    if (found) return respond(found, fp, { genError: msg });
    return Response.json({ error: msg }, { status: 503 });
  }

  // 3. 生成并原子写（内容 + meta sidecar 一并升级格式）
  const date = new Date().toISOString().slice(0, 10);
  try {
    const content = await completeChat([{ role: "user", content: buildPrompt(info, date) }], {
      signal: AbortSignal.timeout(45_000),
      // 关思考优先（本机网关实测快约一倍；端点不认自动降级 reasoningEffort），缩短详情页等待
      disableThinking: true,
      reasoningEffort: "low",
      temperature: 0.3,
    });
    const meta: ArtifactMeta = {
      schemaVersion: 1,
      kind: "verdict",
      generatedAt: new Date().toISOString(),
      sourceDate: date,
      sourceUpdatedAt,
      sourceFingerprint: fp,
      model: (await resolveAiConfig()).model,
    };
    await writeArtifact(exactFile, content, meta);
    return Response.json({ cached: false, freshness: "fresh", content, meta });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 502;
    const msg = status === 503 ? "未配置 AI 接入，无法生成判读" : `AI 生成失败：${(err as Error).message}`;
    // 生成失败但有旧正文 → 200 + 旧内容 + genError（"保留旧内容并展示错误"）
    if (found) {
      return respond(found, fp, { genError: msg });
    }
    return Response.json({ error: msg }, { status });
  }
}
