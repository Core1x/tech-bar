// M3 项目决策卡装配层（web 端；纯函数在 core/domain/decision.ts）。
// 设计（§9.1/§9.2 + M0.2 新鲜度）：
//   - 结论/事实/风险 = 确定性、每次现算（不入库、零漂移）；AI 只缓存四段解释（适合/不适合/现在看/未知）。
//   - 产物 = data/cache/decisions/{o}__{n}__{指纹}.md（每行「段名 || 文本」）+ .meta.json sidecar（kind=decision）。
//   - 指纹输入 = 喂给模型的可核实事实（描述/许可/维护/话题/量级桶/池时间/趋势样本数/README 哈希+部署行）。
//     release 是「可选一次补充请求」：只进展示与 prompt 的定性一句，不进指纹——配额抖动不应假报过期。
//   - 旧产物（无 sidecar）=legacy；重新生成成功写当前指纹文件；AI 失败但有旧版本 → 保留旧解释 + genError。
//   - 放 lib/ 因需 lib/github 实时拉取（core 不 import lib，同 cross-weekly 先例）。
import path from "node:path";
import { getRepo, getReadmeRaw, ghGetJson } from "@/lib/github";
import {
  readLatest,
  readReadmeCache,
  writeReadmeCache,
  listGithubHistoryDates,
  readStarHistoryIndex,
} from "@/lib/data";
import { hasDeepSeekKey, completeChat } from "@/lib/deepseek";
import { resolveAiConfig } from "@/lib/ai-config";
import { freshnessOf, type ArtifactFreshness, type ArtifactMeta } from "@/core/domain/artifact";
import { readArtifactMeta, writeArtifact } from "@/core/store/artifact";
import { lastPushAgeDays } from "@/core/domain/signals";
import {
  decisionFingerprint,
  parseDecisionSections,
  readmeDigest,
  ruleConclusion,
  ruleRisks,
  type DecisionConclusion,
  type DecisionFacts,
  type DecisionSections,
} from "@/core/domain/decision";

export const DECISION_DIR = path.join(process.cwd(), "data", "cache", "decisions");

export interface DecisionResponse {
  ok: true;
  fullName: string;
  facts: DecisionFacts;
  conclusion: DecisionConclusion;
  risks: string[];
  /** 缓存的 AI 解释（未生成=null） */
  sections: DecisionSections | null;
  /** 解释相对当前输入的新鲜度；未生成=null */
  freshness: ArtifactFreshness | null;
  generatedAt: string | null;
  model?: string | null;
  /** 生成失败说明（解释区显示红条；确定性部分照常展示） */
  genError?: string | null;
}

/** 最新 release（可选补充请求；失败/无 → null，不阻塞决策卡） */
async function fetchReleaseSafe(owner: string, name: string): Promise<{ tag: string; publishedAt: string | null } | null> {
  try {
    const r = await Promise.race([
      ghGetJson<{ tag_name?: string; published_at?: string }>(`/repos/${owner}/${name}/releases/latest`),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    if (!r || r.status !== 200 || !r.data?.tag_name) return null;
    return { tag: r.data.tag_name, publishedAt: r.data.published_at?.slice(0, 10) ?? null };
  } catch {
    return null;
  }
}

async function assembleFacts(fullName: string): Promise<DecisionFacts | null> {
  const [owner, name] = fullName.split("/");
  const latest = await readLatest();
  const poolRow =
    latest?.trending?.find((r) => r.full_name === fullName) ??
    latest?.new_stars.find((r) => r.full_name === fullName) ??
    latest?.tracked.find((r) => r.full_name === fullName) ??
    null;
  type Poolish = Record<string, unknown>;
  let base: {
    description: string | null;
    summary: string | null;
    language: string | null;
    stars: number;
    forks: number | null;
    openIssues: number | null;
    /** undefined=未采集；null=确无 */
    license: string | null | undefined;
    archived: boolean | undefined;
    pushedAt: string | null;
    createdAt: string | null;
    topics: string[];
    deltaToday: number | null;
    poolDate: string | null;
  };
  if (poolRow) {
    const row = poolRow as unknown as Poolish;
    const isTrending = "stars_today" in row;
    base = {
      description: (row.description as string | null) ?? null,
      summary: (row.summary as string | null) ?? null,
      language: (row.language as string | null) ?? null,
      stars: row.stars as number,
      forks: (row.forks as number | null | undefined) ?? null,
      openIssues: (row.open_issues as number | null | undefined) ?? null,
      // 三态保持：键不存在/值 null|undefined（旧快照缺字段）= 未知；显式字符串/null=确无（license）
      license: "license" in row ? (row.license as string | null | undefined) : undefined,
      archived: "archived" in row ? ((row.archived as boolean | null | undefined) ?? undefined) : undefined,
      pushedAt: (row.pushed_at as string | null | undefined) ?? null,
      createdAt: (row.created_at as string | null | undefined) ?? null,
      topics: Array.isArray(row.topics) ? (row.topics as string[]) : [],
      deltaToday: isTrending
        ? (row.stars_today as number | null | undefined) ?? null
        : (row.delta_1d as number | null | undefined) ?? null,
      poolDate: latest?.updated_at ?? null,
    };
  } else {
    const gh = await getRepo(owner, name);
    if (!gh?.data) return null;
    base = {
      description: gh.data.description ?? null,
      summary: null,
      language: gh.data.language ?? null,
      stars: gh.data.stargazers_count,
      forks: gh.data.forks_count ?? null,
      openIssues: gh.data.open_issues_count ?? null,
      // API 权威三态：无 license 字段=未带（未知）；license:null=确无；有对象取 spdx_id
      license:
        gh.data.license === undefined
          ? undefined
          : gh.data.license === null
            ? null
            : gh.data.license.spdx_id ?? "NOASSERTION",
      archived: gh.data.archived ?? undefined,
      pushedAt: (gh.data.pushed_at ?? "").slice(0, 10) || null,
      createdAt: gh.data.created_at?.slice(0, 10) ?? null,
      topics: gh.data.topics ?? [],
      deltaToday: null,
      poolDate: new Date().toISOString(), // 实时拉取行：数据时间=拉取时刻
    };
  }

  // README：先读缓存；无则一次 raw 拉取并写缓存（与 README 查看器共用缓存，互不重复烧配额）
  let readmeText: string | null = await readReadmeCache(owner, name);
  if (readmeText === null) {
    const r = await getReadmeRaw(owner, name);
    if (r.content) {
      readmeText = r.content;
      await writeReadmeCache(owner, name, r.content).catch(() => undefined);
    }
  }

  // 本站趋势样本数：star-history 索引里该仓的点数；索引未命中回退历史快照总天数（保守）
  let trendPoints = 0;
  try {
    const idx = await readStarHistoryIndex();
    trendPoints = idx?.repos[fullName]?.length ?? 0;
    if (trendPoints === 0) {
      trendPoints = (await listGithubHistoryDates()).length;
    }
  } catch {
    trendPoints = 0;
  }

  const facts: DecisionFacts = {
    fullName,
    description: base.description,
    summary: base.summary,
    language: base.language,
    stars: base.stars,
    forks: base.forks,
    openIssues: base.openIssues,
    license: base.license ?? null,
    licenseKnown: base.license !== undefined,
    archived: base.archived === true,
    archivedKnown: base.archived !== undefined,
    pushedAt: base.pushedAt,
    createdAt: base.createdAt,
    topics: base.topics,
    deltaToday: base.deltaToday,
    poolDate: base.poolDate,
    trendPoints,
    release: await fetchReleaseSafe(owner, name),
    readme: readmeDigest(readmeText),
    lastPushDays: lastPushAgeDays(base.pushedAt ?? undefined),
  };
  return facts;
}

function decisionPrompt(f: DecisionFacts): string {
  const q = (days: number | null): string =>
    days === null ? "最近推送时间未知" : days <= 30 ? "近一个月内仍在推送" : days <= 180 ? "近半年内有推送" : days <= 365 ? "已近一年未推送" : "超过一年未推送";
  const lic = f.licenseKnown ? (f.license === null || f.license === "" || f.license === "NOASSERTION" ? "无明确许可证" : f.license) : "许可证未采集（未知）";
  const delta = f.deltaToday === null ? "今日增量未采集" : f.deltaToday > 0 ? "今日 star 有明显新增（数字由界面展示，正文勿引用）" : "今日 star 无新增";
  return `你是开源项目选型顾问。基于下方「已核实事实」为该仓库写「项目决策」解释。只输出 4 行，格式严格为「段名 || 文本」，不要序号、不要其它文字、不要 Markdown；文本用简体中文，各段不超过 40 字。
段名依次为：适合、不适合、现在、未知。
- 适合：什么场景/人群适合用它（只能依据描述、话题、README 标题与部署行推断）。
- 不适合：什么情况下不建议选它（可结合部署方式与许可）。
- 现在：结合维护状态与趋势样本，说是否「现在」值得花时间看（一句话）。
- 未知：现有数据无法判断的维度（代码质量、issue 响应、实际性能等——必须如实说无法判断）。
纪律：正文不得出现具体数字；不得从 star 高推导「代码质量高/社区支持好」；未给出的信息一律归入「未知」；
事实里标注「未看到 / 未采集 / 未读取到」的项（如 release、README），正文不得声称其存在或引用其内容。

事实：
- 仓库：${f.fullName}
- 描述：${f.summary || f.description || "（无描述）"}
- 语言：${f.language ?? "未知"}｜许可证：${lic}｜归档：${f.archivedKnown ? (f.archived ? "已归档" : "未归档") : "未采集"}
- 维护：${q(f.lastPushDays)}｜创建于 ${f.createdAt ?? "未知"}｜${delta}｜本站趋势采样 ${f.trendPoints >= 3 ? "≥3 天（有走势参考）" : "不足 3 天（无走势）"}
- release：${f.release ? "有正式发布" : "未看到正式 release"}
- README 章节：${f.readme.available ? f.readme.headings.slice(0, 6).join(" / ") || "（无标题结构）" : "未读取到 README"}
- 部署/运行线索（README 原文行）：${f.readme.deploy.length ? f.readme.deploy.map((d) => `「${d}」`).join(" ") : "未提取到"}`;
}

function fileFor(fullName: string, fp: string): string {
  return path.join(DECISION_DIR, `${fullName.replace("/", "__")}__${fp}.md`);
}

async function readFileSafe(file: string): Promise<string | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    return await readFile(file, "utf-8");
  } catch {
    return null;
  }
}

async function findAnyArtifact(fullName: string): Promise<{ content: string; meta: ArtifactMeta | null } | null> {
  const { readdir, stat } = await import("node:fs/promises");
  let names: string[];
  try {
    names = await readdir(DECISION_DIR);
  } catch {
    return null;
  }
  const prefix = `${fullName.replace("/", "__")}__`;
  const dated = await Promise.all(
    names
      .filter((f) => f.startsWith(prefix) && f.endsWith(".md"))
      .map(async (f) => {
        const file = path.join(DECISION_DIR, f);
        try {
          const st = await stat(file);
          return { file, t: st.mtimeMs };
        } catch {
          return { file, t: 0 };
        }
      }),
  );
  dated.sort((a, b) => b.t - a.t);
  for (const d of dated) {
    const content = await readFileSafe(d.file);
    if (content === null) continue;
    return { content, meta: await readArtifactMeta(d.file) };
  }
  return null;
}

function respond(
  facts: DecisionFacts,
  extra: {
    sections: DecisionSections | null;
    freshness: ArtifactFreshness | null;
    generatedAt?: string | null;
    model?: string | null;
    genError?: string | null;
  },
): DecisionResponse {
  return {
    ok: true,
    fullName: facts.fullName,
    facts,
    conclusion: ruleConclusion(facts),
    risks: ruleRisks(facts),
    sections: extra.sections,
    freshness: extra.freshness,
    generatedAt: extra.generatedAt ?? null,
    model: extra.model ?? null,
    genError: extra.genError ?? null,
  };
}

/** 只读：事实每次现算 + 比对既有解释的指纹（零 AI；release/README 最多各一次 GitHub 请求且共用缓存） */
export async function peekDecision(fullName: string): Promise<DecisionResponse> {
  const facts = await assembleFacts(fullName);
  if (!facts) {
    throw Object.assign(new Error("仓库信息获取失败（不在今日榜单，且实时拉取失败或仓库不存在）"), { status: 404 });
  }
  const fp = decisionFingerprint(facts);
  const exactFile = fileFor(fullName, fp);
  const content = await readFileSafe(exactFile);
  if (content !== null) {
    const meta = await readArtifactMeta(exactFile);
    return respond(facts, {
      sections: parseDecisionSections(content),
      freshness: freshnessOf(meta, fp),
      generatedAt: meta?.generatedAt ?? null,
      model: meta?.model ?? null,
    });
  }
  const older = await findAnyArtifact(fullName);
  if (older) {
    return respond(facts, {
      sections: parseDecisionSections(older.content),
      freshness: freshnessOf(older.meta, fp),
      generatedAt: older.meta?.generatedAt ?? null,
      model: older.meta?.model ?? null,
    });
  }
  return respond(facts, { sections: null, freshness: null });
}

/** 生成/重新生成解释（确定性部分无论 AI 成败都照常返回） */
export async function generateDecision(fullName: string): Promise<DecisionResponse> {
  const facts = await assembleFacts(fullName);
  if (!facts) {
    throw Object.assign(new Error("仓库信息获取失败（不在今日榜单，且实时拉取失败或仓库不存在）"), { status: 404 });
  }
  const fp = decisionFingerprint(facts);
  const exactFile = fileFor(fullName, fp);
  const existing = await readFileSafe(exactFile);
  if (existing !== null) {
    const meta = await readArtifactMeta(exactFile);
    return respond(facts, {
      sections: parseDecisionSections(existing),
      freshness: freshnessOf(meta, fp),
      generatedAt: meta?.generatedAt ?? null,
      model: meta?.model ?? null,
    });
  }
  if (!(await hasDeepSeekKey())) {
    const msg = "未配置 AI 接入，无法生成决策解释（结论/事实/风险已确定性展示；可在「设置」页填写）";
    const older = await findAnyArtifact(fullName);
    return respond(facts, {
      sections: older ? parseDecisionSections(older.content) : null,
      freshness: older ? (freshnessOf(older.meta, fp) === "legacy" ? "legacy" : "stale") : null,
      generatedAt: older?.meta?.generatedAt ?? null,
      genError: msg,
    });
  }
  try {
    const raw = await completeChat([{ role: "user", content: decisionPrompt(facts) }], {
      signal: AbortSignal.timeout(60_000),
      disableThinking: true,
      reasoningEffort: "low",
      maxTokens: 600,
      temperature: 0.4,
    });
    const sections = parseDecisionSections(raw);
    const meta: ArtifactMeta = {
      schemaVersion: 1,
      kind: "decision",
      generatedAt: new Date().toISOString(),
      sourceDate: new Date().toISOString().slice(0, 10),
      sourceUpdatedAt: facts.poolDate,
      sourceFingerprint: fp,
      model: (await resolveAiConfig()).model,
    };
    const asText = [
      `适合 || ${sections.fit ?? ""}`,
      `不适合 || ${sections.unfit ?? ""}`,
      `现在 || ${sections.whyNow ?? ""}`,
      `未知 || ${sections.unknowns ?? ""}`,
    ].join("\n");
    await writeArtifact(exactFile, asText + "\n", meta);
    return respond(facts, { sections, freshness: "fresh", generatedAt: meta.generatedAt, model: meta.model ?? null });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 502;
    const msg = status === 503 ? "未配置 AI 接入，无法生成决策解释" : `AI 生成失败：${(err as Error).message}`;
    const older = await findAnyArtifact(fullName);
    return respond(facts, {
      sections: older ? parseDecisionSections(older.content) : null,
      freshness: older ? (freshnessOf(older.meta, fp) === "legacy" ? "legacy" : "stale") : null,
      generatedAt: older?.meta?.generatedAt ?? null,
      genError: msg,
    });
  }
}
