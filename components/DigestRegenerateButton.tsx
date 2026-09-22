"use client";
// 「数据已更新 · 重新生成今日洞察」（M4 §10.2）：POST /api/digest?force=1（单飞锁内覆盖旧产物）。
// 数据更新中会 409；后台已有同名任务 running→提示等待；成功后 router.refresh 拉新正文。
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DigestRegenerateButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function regenerate() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/digest?force=1", { method: "POST" });
      const j = (await res.json()) as { ok?: boolean; running?: boolean; created?: boolean; error?: string };
      if (res.ok && (j.created || j.running)) {
        router.refresh();
        if (j.running) setErr("已有生成任务在跑，稍后自动完成，可刷新查看");
      } else {
        setErr(j.error ?? `生成失败（HTTP ${res.status}）`);
      }
    } catch {
      setErr("网络异常，生成失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={regenerate}
        disabled={busy}
        className="rounded-md border border-[#58a6ff]/50 bg-[#58a6ff]/10 px-2.5 py-1 text-xs text-[#58a6ff] transition-colors hover:bg-[#58a6ff]/20 disabled:opacity-50"
      >
        {busy ? "生成中…" : "重新生成"}
      </button>
      {err ? <span className="text-xs text-[#f85149]">{err}</span> : null}
    </span>
  );
}
