"use client";
// M3「项目决策」卡（§9.1 固定结构，替代旧「AI 判读 + AI 评测」双卡）：
//   ① 结论（确定性规则，保守口径）② 适合场景 ③ 不适合场景 ④ 为什么现在值得看
//   ⑤ 确定性事实 ⑥ 风险 ⑦ 尚无法判断 ⑧ 生成时间/数据时间/重新生成。
// 事实/结论/风险每次现算（零漂移）；②④⑦ 为 AI 解释，走 M0.2 新鲜度七态（peek 挂载、展开才生成）。
// 无 AI Key：卡照常可用（确定性部分完整），解释区给「未接入 AI」提示（§3.5）。
import { useEffect, useRef, useState } from "react";
import type { ArtifactFreshness } from "@/core/domain/artifact";
import type { DecisionConclusion, DecisionFacts, DecisionSections } from "@/core/domain/decision";
import { AiUnavailableNotice } from "./AiUnavailableNotice";
import { ArtifactNotice, ArtifactProvenance } from "./ArtifactProvenance";
import { AiCollapseRow, usePersistedOpen, type AiRowStatus } from "./AiCollapseRow";

interface DecisionResponse {
  ok: true;
  fullName: string;
  facts: DecisionFacts;
  conclusion: DecisionConclusion;
  risks: string[];
  sections: DecisionSections | null;
  freshness: ArtifactFreshness | null;
  generatedAt: string | null;
  model?: string | null;
  genError?: string | null;
}

const CONCLUSION_STYLE: Record<DecisionConclusion, string> = {
  推荐尝试: "border-[#3fb950]/40 bg-[#3fb950]/10 text-[#3fb950]",
  继续观察: "border-[#58a6ff]/40 bg-[#58a6ff]/10 text-[#58a6ff]",
  谨慎投入: "border-[#d29922]/40 bg-[#d29922]/10 text-[#d29922]",
  仅供参考: "border-[#8b949e]/40 bg-[#21262d] text-[#8b949e]",
};

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("en-US");
}

function FactRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[#21262d] py-1.5 last:border-0">
      <span className="shrink-0 text-xs text-[#8b949e]">{label}</span>
      <span className="min-w-0 break-words text-right text-sm text-[#e6edf3]" title={hint}>
        {value}
      </span>
    </div>
  );
}

export function ProjectDecision({
  repo,
  auto = false,
  hasKey = true,
}: {
  repo: string;
  auto?: boolean;
  hasKey?: boolean;
}) {
  const [data, setData] = useState<DecisionResponse | null>(null);
  const [state, setState] = useState<"peeking" | "ready" | "error">("peeking");
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, toggleOpen] = usePersistedOpen(`aiPanel:${repo}:decision`);
  const autoStartedRef = useRef(false);

  // 挂载即 peek（组件按 key={repo} 重挂载，无需在 effect 里复位）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/decision?repo=${encodeURIComponent(repo)}&peek=1`);
        const j = (await res.json()) as DecisionResponse & { error?: string };
        if (cancelled) return;
        if (res.ok && j.ok) {
          setData(j);
          setState("ready");
        } else {
          setErrorMsg(j.error ?? `加载失败（HTTP ${res.status}）`);
          setState("error");
        }
      } catch {
        if (!cancelled) {
          setErrorMsg("网络异常，决策卡加载失败");
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo]);

  async function generate() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/decision?repo=${encodeURIComponent(repo)}`);
      const j = (await res.json()) as DecisionResponse & { error?: string };
      if (res.ok && j.ok) {
        setData(j);
        setState("ready");
      } else {
        setErrorMsg(j.error ?? `生成失败（HTTP ${res.status}）`);
        setState("error");
      }
    } catch {
      setErrorMsg("网络异常，生成失败");
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  // auto：首次展开且解释未生成过时补一次（stale 不自动重生成，token 保守口径同 AiInsight）
  useEffect(() => {
    if (auto && hasKey && open && data && data.freshness === null && !autoStartedRef.current) {
      autoStartedRef.current = true;
      void generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 一次性守卫；generate 闭包引用当期 data
  }, [auto, hasKey, open, data]);

  const f = data?.facts;
  const status: AiRowStatus =
    busy
      ? "generating"
      : state === "error"
        ? "failed"
        : state === "peeking"
          ? "checking"
          : data?.genError
            ? "failed"
            : data?.freshness === "stale"
              ? "stale"
              : data?.freshness === "legacy"
                ? "legacy"
                : data?.sections
                  ? "ready"
                  : !hasKey
                    ? "no-key"
                    : "missing";

  return (
    <AiCollapseRow
      title="项目决策"
      hint={auto ? "自动 · 展开时生成解释" : "结论确定性 · AI 写解释"}
      status={status}
      open={open}
      onToggle={toggleOpen}
    >
      {state === "peeking" && !f && (
        <div className="space-y-2 py-1">
          <div className="h-3 w-2/3 animate-pulse rounded bg-[#21262d]" />
          <div className="h-3 w-full animate-pulse rounded bg-[#21262d]" />
          <p className="pt-1 text-xs text-[#8b949e]">检查决策依据…</p>
        </div>
      )}

      {state === "error" && !f && (
        <div className="rounded-md border border-[#f85149]/30 bg-[#f85149]/10 px-3 py-2 text-xs text-[#f85149]">
          {errorMsg}
          <button onClick={generate} disabled={busy} className="ml-2 underline disabled:opacity-50">
            重试
          </button>
        </div>
      )}

      {f && (
        <div className="space-y-4">
          {/* ① 结论（确定性规则） */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#8b949e]">结论</span>
            <span className={`rounded-full border px-2.5 py-0.5 text-sm font-semibold ${CONCLUSION_STYLE[data?.conclusion ?? "继续观察"]}`}>
              {data?.conclusion ?? "—"}
            </span>
            <span className="text-[11px] text-[#8b949e]">由归档/维护/许可/增量确定性规则得出（非 AI 判断）</span>
          </div>

          {/* AI 解释区：状态条 + 四段（②③⑦） */}
          {data?.genError ? (
            <ArtifactNotice kind="failed" error={data.genError} hasKey={hasKey} busy={busy} onRegenerate={generate} />
          ) : data?.freshness === "stale" ? (
            <ArtifactNotice kind="stale" hasKey={hasKey} busy={busy} onRegenerate={generate} />
          ) : data?.freshness === "legacy" ? (
            <ArtifactNotice kind="legacy" hasKey={hasKey} busy={busy} onRegenerate={generate} />
          ) : null}

          {data?.sections ? (
            <div className="space-y-1.5">
              {(
                [
                  ["适合场景", data.sections.fit],
                  ["不适合场景", data.sections.unfit],
                  ["为什么现在值得看", data.sections.whyNow],
                ] as const
              ).map(([label, text]) =>
                text ? (
                  <p key={label} className="text-sm text-[#c9d1d9]">
                    <span className="mr-1.5 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 text-[10px] text-[#8b949e]">{label}</span>
                    {text}
                  </p>
                ) : null,
              )}
              <p className="text-sm text-[#c9d1d9]">
                <span className="mr-1.5 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 text-[10px] text-[#8b949e]">尚无法判断</span>
                {data.sections.unknowns ?? "代码质量、社区响应速度、实际性能等，现有数据无法判断。"}
              </p>
              {/* ⑧ 生成时间 / 数据时间 */}
              <ArtifactProvenance meta={data.freshness === "legacy" ? null : { schemaVersion: 1, kind: "decision", generatedAt: data.generatedAt ?? "", sourceDate: f.poolDate?.slice(0, 10) ?? "", sourceUpdatedAt: f.poolDate, sourceFingerprint: "" }} />
            </div>
          ) : busy ? (
            <p className="text-xs text-[#8b949e]">正在生成解释（约 10-40 秒）… 下方事实区可先行阅读</p>
          ) : hasKey ? (
            <div>
              <p className="text-sm text-[#8b949e]">AI 解释（适合/不适合/现在看/未知）尚未生成</p>
              <button
                onClick={generate}
                disabled={busy}
                className="mt-2 rounded-md bg-[#238636] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#2ea043] disabled:opacity-50"
              >
                生成 AI 解释
              </button>
              <p className="mt-1 text-[11px] text-[#8b949e]">仅点按时消耗 token；结论与事实不依赖 AI</p>
            </div>
          ) : (
            <AiUnavailableNotice what="AI 决策解释（结论与事实已确定性展示）" />
          )}

          {/* ⑤ 确定性事实 */}
          <div>
            <p className="mb-1 text-xs font-semibold text-[#8b949e]">确定性事实</p>
            <div className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-1">
              <FactRow label="总 star / 近日新增" value={`★ ${fmt(f.stars)} / ${f.deltaToday === null ? "—" : `+${fmt(f.deltaToday)}`}`} hint={`数据时间 ${f.poolDate?.slice(0, 16).replace("T", " ") ?? "未知"}`} />
              <FactRow label="fork / open issues" value={`${fmt(f.forks)} / ${fmt(f.openIssues)}`} hint="「—」= 未采集，非零" />
              <FactRow label="许可证" value={f.licenseKnown ? (f.license && f.license !== "NOASSERTION" ? f.license : "无明确许可证") : "未知"} />
              <FactRow label="维护状态" value={f.pushedAt ? `${f.pushedAt}${f.lastPushDays !== null ? `（${f.lastPushDays} 天前）` : ""}` : "未知"} />
              <FactRow label="语言 / 创建于" value={`${f.language ?? "—"} / ${f.createdAt ?? "—"}`} />
              <FactRow label="最新 release" value={f.release ? `${f.release.tag}${f.release.publishedAt ? ` · ${f.release.publishedAt}` : ""}` : "未看到正式发布"} />
              <FactRow label="本站趋势样本" value={`${f.trendPoints} 天${f.trendPoints < 3 ? "（样本不足，暂不能判断趋势）" : ""}`} />
              {f.readme.deploy.length > 0 && (
                <FactRow label="README 部署线索" value={f.readme.deploy[0]} hint={f.readme.deploy.join("\n")} />
              )}
            </div>
          </div>

          {/* ⑥ 风险（确定性） */}
          {data && data.risks.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-[#8b949e]">风险</p>
              <ul className="space-y-1">
                {data.risks.map((r) => (
                  <li key={r} className="flex items-start gap-1.5 text-sm text-[#c9d1d9]">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#d29922]" aria-hidden />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </AiCollapseRow>
  );
}
