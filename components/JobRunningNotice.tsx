// 生成中提示：展示“AI 周报/洞察正在后台生成”，轮询 /api/gen-status，
// 任务一结束（running 变空）自动刷新页面以展示产物/恢复生成按钮。
"use client";
import { useEffect } from "react";

export function JobRunningNotice({ text }: { text: string }) {
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/gen-status");
        if (!res.ok) return;
        const j = (await res.json()) as { running?: { kind?: string } | null };
        if (cancelled) return;
        if (!j.running) {
          window.location.reload();
        }
      } catch {
        // 网络抖动：下一轮再试
      }
    };
    void tick();
    const timer = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="rounded-lg border border-[#f78166]/40 bg-[#f78166]/10 p-4 text-sm text-[#e6edf3]">
      {text}
    </div>
  );
}
