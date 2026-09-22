// 热榜查询式「实跑体检」（开发期一次性命令，cli/hot.ts probe 调用；不落业务快照、不改配置）。
// 目的：把每类目查询式的真实召回摊开给人看——召回/去重/入榜/出榜分布 + top 结果，
// 供逐类目确认「查询式是否召到真属该类的项目、有没有把无关项目也召进来」。发现问题 → 改
// data/config/hot-categories.json 里的 queries（查询式是类目质量唯一真相源，人可读、git 可 diff）→ 再跑。
// 口径说明：本体检**不探 README**（省核心配额），故 kept 只含「归档/Fork/无描述/star 门槛」四类
// 技术性排除，真实重建（rebuild）可能因「无 README」再少几条。运行期零 AI。
import path from "node:path";
import { readHotCategories } from "@/core/config/hot-categories";
import { assembleHotSections } from "@/core/domain/hot-filter";
import { localDateStr } from "@/core/domain/calendar";
import { HOT_DIR, atomicWrite } from "@/core/store/file";
import { collectHotSections } from "@/core/sources/github/hot";

const TOP_N = 8;

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * 实跑全部类目查询式 → 生成体检报告（控制台摘要 + 落 data/hot/probe-report-{date}.md）。
 * 无类目配置 → code 1。搜索受限/失败 → code 2（报告仍出，标注受影响类目）。
 */
export async function runHotProbe(): Promise<{ code: number; reportPath: string | null; message: string }> {
  const cats = await readHotCategories();
  if (cats.length === 0) {
    return { code: 1, reportPath: null, message: "无类目配置（data/config/hot-categories.json），先写查询式" };
  }

  const { sections, partial } = await collectHotSections();
  const assembled = assembleHotSections(sections);

  const date = localDateStr();
  const lines: string[] = [];
  lines.push(`# GitHub 热榜查询式体检报告 · ${date}`);
  lines.push("");
  lines.push(`- 类目数：${cats.length}｜口径：实跑 searchRepos（sort=stars），**未探 README**，kept 不含「无 README」排除。`);
  if (partial) lines.push(`- ⚠️ 本轮有搜索受限/失败，个别类目召回可能不全（详见各类目「召回 0」或控制台）。`);
  lines.push("");

  const reasonCount = new Map<string, number>();
  for (const f of assembled.filtered) reasonCount.set(f.reason, (reasonCount.get(f.reason) ?? 0) + 1);

  for (const sec of assembled.categories) {
    const raw = sections.find((s) => s.id === sec.id);
    const recalled = raw?.items.length ?? 0;
    const uniqueNames = new Set((raw?.items ?? []).map((i) => i.full_name)).size;
    lines.push(`## ${sec.label}（\`${sec.id}\` · 门槛 ★${fmtInt(raw?.starFloor ?? 0)}）`);
    const catQueries = cats.find((c) => c.id === sec.id)?.queries ?? [];
    lines.push(`- 查询式：${catQueries.map((q) => `\`${q}\``).join(" ＋ ")}`);
    lines.push(`- 召回 ${recalled}（去重 ${uniqueNames}）→ 入榜 ${sec.items.length}`);
    if (sec.items.length === 0) {
      lines.push(`- ⚠️ **入榜 0**：查询式可能过窄/无匹配，建议换 topic 或降 starFloor`);
    } else {
      lines.push(`- Top ${Math.min(TOP_N, sec.items.length)}：`);
      for (const it of sec.items.slice(0, TOP_N)) {
        const desc = (it.description ?? "").slice(0, 60);
        lines.push(`  - **${it.full_name}** ★${fmtInt(it.stars)}${it.language ? ` · ${it.language}` : ""} — ${desc}`);
      }
    }
    lines.push("");
  }

  lines.push(`## 出榜原因分布（全类目去重前）`);
  if (reasonCount.size === 0) lines.push(`- 无出榜条目`);
  for (const [reason, n] of [...reasonCount.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${reason}：${n}`);
  }
  lines.push("");
  lines.push(`> 逐类目核对 top 是否真属该类；不符 → 调 \`queries\` 后 \`node dist/cli/hot.mjs probe\` 复跑。满意后 \`rebuild\` 落榜。`);

  const report = lines.join("\n");
  const reportPath = path.join(HOT_DIR, `probe-report-${date}.md`);
  try {
    await atomicWrite(reportPath, report);
  } catch {
    return { code: partial ? 2 : 0, reportPath: null, message: "报告落盘失败（控制台已打印）\n" + report };
  }

  const totalKept = assembled.categories.reduce((n, c) => n + c.items.length, 0);
  const message = `体检完成：${cats.length} 类目 / 入榜合计 ${totalKept} / 出榜 ${assembled.filtered.length}`;
  console.log(report);
  return { code: partial ? 2 : 0, reportPath, message };
}
