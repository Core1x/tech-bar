"use client";
// M5 §11.2 数据源管理卡：列出全部可用源（registry）、当前是否启用、最后成功更新时间、网络要求说明，
// 拨开关即写 data/config/active-sources.json（不另建配置、与后端读同一真相源）。乐观更新 + 失败回滚。
import { useEffect, useState } from "react";

interface SourceRow {
  id: string;
  label: string;
  active: boolean;
  lastSuccessAt: string | null;
  networkHint: string;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "从未拉取";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 16);
  const days = Math.floor((Date.now() - t) / 86_400_000);
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  const rel = days <= 0 ? "今天" : days === 1 ? "昨天" : `${days} 天前`;
  return `${rel} · ${stamp}`;
}

export function SourceManagerCard() {
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/sources");
          const j = (await res.json()) as { sources?: SourceRow[]; error?: string };
          if (Array.isArray(j.sources)) setSources(j.sources);
          else setError(j.error ?? "数据源读取失败");
        } catch {
          setError("网络异常，数据源读取失败");
        }
      })();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  async function toggle(id: string) {
    if (!sources || pendingId) return;
    const cur = sources.find((s) => s.id === id);
    if (!cur) return;
    // GitHub 主源可停用但界面提示影响（后端允许任意子集，只挡「全部停用」）
    const nextActive = sources.filter((s) => (s.id === id ? !cur.active : s.active)).map((s) => s.id);
    if (nextActive.length === 0) {
      setError("至少保留一个启用源");
      return;
    }
    setError(null);
    const prev = sources;
    setSources(sources.map((s) => (s.id === id ? { ...s, active: !s.active } : s)));
    setPendingId(id);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: nextActive }),
      });
      const j = (await res.json()) as { ok?: boolean; active?: string[]; error?: string };
      if (!res.ok || !j.ok) {
        setSources(prev);
        setError(j.error ?? "保存失败");
      } else if (Array.isArray(j.active)) {
        setSources(prev.map((s) => ({ ...s, active: j.active!.includes(s.id) })));
      }
    } catch {
      setSources(prev);
      setError("网络异常，保存失败");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-[#e6edf3]">数据源启用 / 停用</p>
      <p className="mb-3 text-xs text-[#8b949e]">
        即时写入 <code className="rounded bg-[#21262d] px-1 text-[#58a6ff]">active-sources.json</code>，决定首页信息流板块与每日更新拉取哪些源。
      </p>

      {error && <p className="mb-2 text-xs text-[#f85149]">{error}</p>}

      {sources === null ? (
        <div className="h-4 w-1/3 animate-pulse rounded bg-[#21262d]" />
      ) : (
        <ul className="space-y-2">
          {sources.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#e6edf3]">
                  {s.label}
                  {s.networkHint.includes("代理") && (
                    <span className="ml-2 rounded-full border border-[#d29922]/40 bg-[#d29922]/10 px-1.5 py-0.5 text-[10px] text-[#d29922]">
                      需梯子
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-[#8b949e]">
                  最后更新 {fmtWhen(s.lastSuccessAt)} · {s.networkHint}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={s.active}
                aria-label={`启用 ${s.label}`}
                disabled={pendingId === s.id}
                onClick={() => toggle(s.id)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  s.active ? "bg-[#238636]" : "bg-[#30363d]"
                } ${pendingId === s.id ? "opacity-50" : ""}`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    s.active ? "translate-x-[18px]" : "translate-x-[2px]"
                  }`}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-[#8b949e]">
        启用外网源（如 Hacker News）需本机具备代理；拉取失败只影响该源板块，不中断其它源。
      </p>
    </div>
  );
}
