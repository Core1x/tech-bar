// 侧边栏底部的用量统计：AI token 今日用量 + GitHub API 每小时配额余量
"use client";
import { useEffect, useState } from "react";

interface UsageData {
  ai: { prompt: number; completion: number; total: number };
  github: { coreRemaining: number | null; coreLimit: number | null } | null;
}

export function UsageBadge() {
  const [data, setData] = useState<UsageData | null>(null);

  useEffect(() => {
    // 移动端侧栏是 hidden md:flex，本组件不可见，跳过轮询与监听，避免后台空转
    if (!window.matchMedia("(min-width: 768px)").matches) return;

    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/usage");
        if (!res.ok) return;
        const j = (await res.json()) as UsageData;
        if (!cancelled) setData(j);
      } catch {
        // 用量统计失败保留旧值，不影响页面
      }
    }
    void load();
    // 每分钟轮询刷新（GitHub 余量随 API 调用减少、AI token 随调用增加）
    const timer = setInterval(load, 60_000);
    // 切回标签页时立即刷新
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const githubText = data?.github
    ? `${(data.github.coreRemaining ?? "?").toLocaleString()} / ${(data.github.coreLimit ?? "?").toLocaleString()}`
    : "…";

  return (
    <div className="mt-2 space-y-1 rounded-md border border-[#21262d] bg-[#0d1117] px-3 py-2 text-[11px] leading-relaxed text-[#8b949e]">
      <p className="flex items-center gap-1.5">
        <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden>
          <path d="M8 1.5 2 4.5v3.5C2 11.7 4.5 14.7 8 15.5c3.5-.8 6-3.8 6-7.5V4.5L8 1.5Zm3 6.75a.75.75 0 0 1-1.5 0v-1.4L7.28 9.07a.75.75 0 0 1-1.06 0L5 7.78a.75.75 0 0 1 1.06-1.06l.78.78 2.44-2.44h-1.4a.75.75 0 0 1 0-1.5h3.12c.41 0 .75.34.75.75v3.13Z" />
        </svg>
        AI Token 今日：<span className="tabular-nums text-[#e6edf3]">{data ? data.ai.total.toLocaleString() : "…"}</span>
      </p>
      <p className="flex items-center gap-1.5">
        <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden>
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27 7.42 7.42 0 0 1 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Zm0 11.75A.75.75 0 0 1 7.25 11V8.75A.75.75 0 0 1 8.75 8.75V11a.75.75 0 0 1-.75.75ZM8.75 7H7.25V3.75h1.5V7Z" />
        </svg>
        GitHub 余量：<span className="tabular-nums text-[#e6edf3]">{githubText}</span>
      </p>
    </div>
  );
}
