// 洞察页「生成今日洞察」按钮：今日洞察缺失时显示，POST /api/digest 生成后刷新页面。
// 若已有同一任务在生成（网页/定时任务），后端返回 { running:true }，这里改为轮询状态、完成自动刷新，绝不重复生成。
"use client";
import { useState } from "react";
import { JobRunningNotice } from "@/components/JobRunningNotice";

export function DigestGenerateButton() {
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/digest", { method: "POST" });
      const j = (await res.json()) as { ok?: boolean; running?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `生成失败（HTTP ${res.status}）`);
        setBusy(false);
        return;
      }
      if (j.running) {
        // 同一任务正在别处生成：交给 JobRunningNotice 轮询、完成后自动刷新
        setBusy(false);
        setQueued(true);
        return;
      }
      window.location.reload();
    } catch {
      setError("网络异常，请稍后重试");
      setBusy(false);
    }
  }

  if (queued) {
    return (
      <JobRunningNotice text="今日洞察正在生成中（由另一页面或定时任务触发）…完成后会自动刷新" />
    );
  }

  return (
    <div>
      <div className="rounded-lg border border-[#f78166]/40 bg-[#f78166]/10 p-4">
        <p className="text-sm text-[#e6edf3]">今天的洞察报告还没有生成（每日 09:00 自动生成，错过可手动补齐）</p>
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={generate}
            disabled={busy}
            className="rounded-md bg-[#238636] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#2ea043] disabled:opacity-50"
          >
            {busy ? "正在生成（约 1-2 分钟）…" : "生成今日洞察"}
          </button>
          {error && <span className="text-sm text-[#f85149]">{error}</span>}
        </div>
      </div>
    </div>
  );
}
