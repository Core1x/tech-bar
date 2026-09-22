// 设置页：两个板块——「AI 接入设置」+「功能设置」。
// - AI 接入：Base URL / 模型 / API Key → data/config/ai-config.json（即时生效，无需重启）
// - 功能设置：GitHub Token + 自动生成开关 → features.json（开关即时保存；日报/周报影响每日定时任务，
//   详情页三项控制“打开仓库页是否自动生成 AI”，未命中缓存才生成）
"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { FeatureKey } from "@/lib/features";
import { SourceManagerCard } from "@/components/SourceManagerCard";
import { PreferencesCard } from "@/components/PreferencesCard";

const inputCls =
  "w-full rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3] placeholder-[#8b949e] outline-none transition-colors focus:border-[#58a6ff]";
const btnGreen =
  "rounded-md bg-[#238636] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#2ea043] disabled:opacity-50";
const dangerLink = "text-xs text-[#f85149] hover:underline disabled:opacity-50";

interface CfgState {
  baseUrl: string;
  model: string;
  keyConfigured: boolean;
  keySource: "website" | "env" | "none";
  keyMasked: string;
  githubTokenConfigured: boolean;
  githubTokenMasked: string;
  defaultBaseUrl: string;
  defaultModel: string;
}

/** 功能开关清单（分组展示） */
const AUTO_TASK_FEATURES: Array<{ key: FeatureKey; title: string; desc: string }> = [
  {
    key: "autoDailyInsight",
    title: "自动生成 AI 日报（每日洞察）",
    desc: "每日定时任务数据更新后自动生成当日《洞察》",
  },
  {
    key: "autoWeeklyReport",
    title: "自动生成 AI 周报",
    desc: "每周一自动整理「上周（周一~周日）」的热门仓库，生成周报",
  },
];
const AUTO_PAGE_FEATURES: Array<{ key: FeatureKey; title: string; desc: string }> = [
  {
    key: "autoDecision",
    title: "打开详情页自动生成「项目决策」AI 解释",
    desc: "结论/事实/风险是确定性直出不受影响；开关只控制首次展开时自动补写适合/不适合等解释，关闭则点按生成",
  },
  {
    key: "autoSimilar",
    title: "打开详情页自动生成 AI 同类取舍",
    desc: "会检索 GitHub 并让 AI 写取舍，最耗 token；关闭则点按生成",
  },
  {
    key: "autoCrossDigest",
    title: "打开首页自动生成「今日跨源值得看」综述",
    desc: "未命中缓存时自动生成跨源综述（约 1-2 分钟）；关闭则点按生成，token 可控",
  },
  {
    key: "autoBriefing",
    title: "自动生成「今日必须看」AI 推荐语",
    desc: "简报候选与依据始终确定性直出（不耗 token）；开关只控制自动为已选候选补写一句 AI 解释，关闭则点按钮生成",
  },
];

function Card({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[#30363d] bg-[#161b22]">
      <div className="border-b border-[#21262d] px-5 py-3.5">
        <h2 className="text-sm font-semibold text-[#e6edf3]">{title}</h2>
        <p className="mt-0.5 text-xs text-[#8b949e]">{desc}</p>
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}

/** GitHub 暗色风格开关 */
function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-[#238636]" : "bg-[#30363d]"
      } ${disabled ? "opacity-50" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

function FeatureRow({
  title,
  desc,
  checked,
  disabled,
  onToggle,
}: {
  title: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-[#e6edf3]">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[#8b949e]">{desc}</p>
      </div>
      <Toggle checked={checked} onChange={onToggle} disabled={disabled} />
    </div>
  );
}

/** 骨架卡：与 Card 同外形（头部 + 占位行），消除 loading 前后的布局跳动 */
function CardSkeleton({ rows }: { rows: number }) {
  return (
    <section className="rounded-lg border border-[#30363d] bg-[#161b22]">
      <div className="border-b border-[#21262d] px-5 py-3.5">
        <div className="h-4 w-28 animate-pulse rounded bg-[#21262d]" />
        <div className="mt-2 h-3 w-48 animate-pulse rounded bg-[#21262d]/70" />
      </div>
      <div className="space-y-4 px-5 py-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-[#21262d]/60" />
        ))}
      </div>
    </section>
  );
}

/** 状态点：ok=绿 / bad=红 */
function StatusPill({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${
        ok
          ? "border-[#3fb950]/30 bg-[#3fb950]/10 text-[#3fb950]"
          : "border-[#f85149]/30 bg-[#f85149]/10 text-[#f85149]"
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ok ? "bg-[#3fb950]" : "bg-[#f85149]"}`} />
      <span className="truncate">{text}</span>
    </span>
  );
}

export default function SettingsPage() {
  const [cfg, setCfg] = useState<CfgState | null>(null);
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingAi, setSavingAi] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [savingFeature, setSavingFeature] = useState<FeatureKey | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/config");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as CfgState & { features?: Record<string, boolean> };
        setCfg(data);
        setBaseUrl(data.baseUrl);
        setModel(data.model);
        setFeatures(data.features ?? null);
      } catch {
        setMessage({ type: "err", text: "读取配置失败，请稍后重试" });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  type ApiResp = Partial<CfgState> & { ok?: boolean; error?: string; features?: Record<string, boolean> };

  /** 统一处理返回：写 cfg + features + 打码后的 key/token 展示状态 */
  function applyResp(data: ApiResp) {
    if (cfg && data.features) setFeatures(data.features);
    setCfg((prev) =>
      prev
        ? {
            ...prev,
            ...(data.baseUrl !== undefined ? { baseUrl: data.baseUrl } : {}),
            ...(data.model !== undefined ? { model: data.model } : {}),
            ...(data.keyConfigured !== undefined ? { keyConfigured: data.keyConfigured } : {}),
            ...(data.keySource !== undefined ? { keySource: data.keySource } : {}),
            ...(data.keyMasked !== undefined ? { keyMasked: data.keyMasked } : {}),
            ...(data.githubTokenConfigured !== undefined
              ? { githubTokenConfigured: data.githubTokenConfigured }
              : {}),
            ...(data.githubTokenMasked !== undefined ? { githubTokenMasked: data.githubTokenMasked } : {}),
          }
        : prev,
    );
  }

  async function post(body: Record<string, unknown>): Promise<ApiResp> {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as ApiResp;
    if (!res.ok) throw new Error(data.error ?? `保存失败（HTTP ${res.status}）`);
    return data;
  }

  async function saveAi() {
    setSavingAi(true);
    setMessage(null);
    try {
      const data = await post({ baseUrl, model, apiKey });
      applyResp(data);
      setApiKey("");
      if (data.baseUrl !== undefined) setBaseUrl(data.baseUrl);
      if (data.model !== undefined) setModel(data.model);
      setMessage({ type: "ok", text: "已保存，即时生效（无需重启）" });
    } catch (e) {
      setMessage({ type: "err", text: (e as Error).message });
    } finally {
      setSavingAi(false);
    }
  }

  async function clearKey() {
    setSavingAi(true);
    setMessage(null);
    try {
      applyResp(await post({ clearKey: true }));
      setApiKey("");
      setMessage({ type: "ok", text: "已清空 AI API Key" });
    } catch (e) {
      setMessage({ type: "err", text: (e as Error).message });
    } finally {
      setSavingAi(false);
    }
  }

  async function saveToken() {
    setSavingToken(true);
    setMessage(null);
    try {
      const data = await post({ githubToken });
      applyResp(data);
      setGithubToken("");
      setMessage({ type: "ok", text: "GitHub Token 已保存（即时生效）" });
    } catch (e) {
      setMessage({ type: "err", text: (e as Error).message });
    } finally {
      setSavingToken(false);
    }
  }

  async function clearToken() {
    setSavingToken(true);
    setMessage(null);
    try {
      applyResp(await post({ clearGithubToken: true }));
      setGithubToken("");
      setMessage({ type: "ok", text: "已清空 GitHub Token" });
    } catch (e) {
      setMessage({ type: "err", text: (e as Error).message });
    } finally {
      setSavingToken(false);
    }
  }

  /** 功能开关：即时保存（乐观更新，失败回滚） */
  async function toggleFeature(key: FeatureKey, value: boolean) {
    if (savingFeature) return;
    setSavingFeature(key);
    setFeatures((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
    try {
      applyResp(await post({ features: { [key]: value } }));
    } catch (e) {
      setFeatures((prev) => ({ ...prev, [key]: !value }));
      setMessage({ type: "err", text: `开关保存失败：${(e as Error).message}` });
    } finally {
      setSavingFeature(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16">
      <header className="flex items-center justify-between border-b border-[#21262d] py-4">
        <div>
          <h1 className="text-xl font-bold text-[#e6edf3]">设置</h1>
          <p className="mt-0.5 text-xs text-[#8b949e]">
            AI 接入与功能开关
          </p>
        </div>
        <Link
          href="/"
          className="rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-[#58a6ff] transition-colors hover:border-[#58a6ff]"
        >
          ← 今日榜单
        </Link>
      </header>

      {message && (
        <div
          className={`mt-4 rounded-md border px-3 py-2 text-sm ${
            message.type === "ok"
              ? "border-[#3fb950]/40 bg-[#3fb950]/10 text-[#3fb950]"
              : "border-[#f85149]/40 bg-[#f85149]/10 text-[#f85149]"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* 两列纵向堆叠（非按行对齐的网格）：左列=AI 接入+数据源，右列=功能设置+兴趣偏好，
          高矮卡片各自流内排列，互不拉扯出空洞 */}
      <div className="mt-6 grid grid-cols-1 items-start gap-6 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-6">
          {/* ── 板块一：AI 接入设置 ── */}
          {loading ? (
            <CardSkeleton rows={6} />
          ) : (
          <Card
            title="AI 接入设置"
            desc="聊天 / 摘要 / 日报 / 判读等 AI 能力的模型接入"
          >
            <StatusPill
              ok={Boolean(cfg?.keyConfigured)}
              text={
                cfg?.keyConfigured
                  ? `已配置（${cfg.keySource === "website" ? "网站" : ".env"}）${cfg.keyMasked}`
                  : "未配置（相关 AI 功能显示降级提示）"
              }
            />

            <div>
              <label className="mb-1 block text-sm font-medium text-[#e6edf3]">
                AI 接入地址（Base URL）
              </label>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={cfg?.defaultBaseUrl ?? "https://api.deepseek.com"}
                className={inputCls}
              />
              <p className="mt-1 text-xs text-[#8b949e]">留空恢复默认；支持任何 OpenAI 兼容接口</p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-[#e6edf3]">模型名</label>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={cfg?.defaultModel ?? "deepseek-chat"}
                className={inputCls}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-[#e6edf3]">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={cfg?.keyConfigured ? "已配置，输入新值覆盖（留空不变）" : "填写 API Key"}
                className={inputCls}
              />
              <p className="mt-1 text-xs text-[#8b949e]">仅存本地目录 data/ </p>
            </div>

            <div className="flex items-center gap-3 border-t border-[#21262d] pt-3">
              <button onClick={saveAi} disabled={savingAi || savingToken} className={btnGreen}>
                {savingAi ? "保存中…" : "保存 AI 接入"}
              </button>
              {cfg?.keyConfigured && (
                <button onClick={clearKey} disabled={savingAi} className={dangerLink}>
                  清空密钥
                </button>
              )}
            </div>
          </Card>
          )}

          {/* ── 板块三：数据源（M5 §11.2），自包含卡（挂载即拉 /api/sources） ── */}
          <Card title="数据源" desc="启用/停用信息源，查看各源最后成功更新与网络要求">
            <SourceManagerCard />
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {/* ── 板块二：功能设置 ── */}
          {loading ? (
            <CardSkeleton rows={10} />
          ) : (
          <Card title="功能设置" desc="GitHub 配额与各类 AI 的自动生成开关">
            {/* GitHub Token */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <label className="block text-sm font-medium text-[#e6edf3]">
                  GitHub Token（可选，配额 60 → 5000 次/小时）
                </label>
                {cfg?.githubTokenConfigured && (
                  <StatusPill ok text={`已配置 ${cfg.githubTokenMasked}`} />
                )}
              </div>
              <input
                type="password"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                placeholder={
                  cfg?.githubTokenConfigured
                    ? "已配置，输入新值覆盖（留空不变）"
                    : "填写 GitHub Personal Access Token"
                }
                className={inputCls}
              />
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <p className="text-xs text-[#8b949e]">
                  GitHub → Settings → Developer settings → Personal access tokens → Fine-grained，
                  仓库选 Public repositories (read-only)，勾 Metadata 与 Contents 只读
                </p>
                {cfg?.githubTokenConfigured && (
                  <button onClick={clearToken} disabled={savingToken} className={`shrink-0 ${dangerLink}`}>
                    清空
                  </button>
                )}
              </div>
              <button
                onClick={saveToken}
                disabled={savingToken || savingAi}
                className={`mt-2 ${btnGreen}`}
              >
                {savingToken ? "保存中…" : "保存 GitHub Token"}
              </button>
            </div>

            {/* 定时任务自动生成 */}
            <div className="border-t border-[#21262d] pt-3">
              <p className="text-xs font-semibold text-[#8b949e]">自动生成 · 定时任务</p>
              <div className="mt-2 space-y-3">
                {AUTO_TASK_FEATURES.map((f) => (
                  <FeatureRow
                    key={f.key}
                    title={f.title}
                    desc={f.desc}
                    checked={Boolean(features?.[f.key])}
                    disabled={savingFeature !== null}
                    onToggle={(v) => toggleFeature(f.key, v)}
                  />
                ))}
              </div>
            </div>

            {/* 详情页自动生成 */}
            <div className="border-t border-[#21262d] pt-3">
              <p className="text-xs font-semibold text-[#8b949e]">自动生成 · 详情页 AI（默认关闭，省 token）</p>
              <div className="mt-2 space-y-3">
                {AUTO_PAGE_FEATURES.map((f) => (
                  <FeatureRow
                    key={f.key}
                    title={f.title}
                    desc={f.desc}
                    checked={Boolean(features?.[f.key])}
                    disabled={savingFeature !== null}
                    onToggle={(v) => toggleFeature(f.key, v)}
                  />
                ))}
              </div>
            </div>
          </Card>
          )}

          {/* ── 板块四：兴趣偏好（M5 §11.3），自包含卡（挂载即拉 /api/preferences） ── */}
          <Card title="兴趣偏好" desc="只影响「今日必须看」加权，不改变原始榜单与信息流">
            <PreferencesCard />
          </Card>
        </div>
      </div>
    </main>
  );
}
