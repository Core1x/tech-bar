// 热榜「重建」按钮：POST /api/hot 后台起 dist/cli/hot.mjs rebuild（零 AI，纯搜索），状态走 useBackgroundTask。
// 挂载即回查：切页离开再回来时，若重建仍在后台进行，按钮自动恢复「重建中」态；本轮观测到结束后刷新展示新快照。
"use client";
import { useEffect, useState } from "react";
import { useBackgroundTask } from "./useBackgroundTask";

export function HotRebuildButton() {
  const { running, completed, begin } = useBackgroundTask("/api/hot", 3000);
  // POST 受理失败只在事件处理器里置值；completed（观测到任务结束）直接派生展示，effect 不 setState
  const [launchError, setLaunchError] = useState<string | null>(null);

  // 观测到重建结束 → 提示片刻后刷新（成功 1.2s；限流部分完成也刷新看已落部分，2.2s）。纯失败(code 1/-1)停留提示不刷新。
  useEffect(() => {
    if (completed && completed.code !== 1 && completed.code !== -1) {
      const t = setTimeout(() => window.location.reload(), completed.code === 0 ? 1200 : 2200);
      return () => clearTimeout(t);
    }
  }, [completed]);

  async function run() {
    if (running) return;
    setLaunchError(null);
    try {
      const res = await fetch("/api/hot", { method: "POST" });
      if (res.ok || res.status === 409) {
        begin(); // 409 = 已有重建在跑 → 直接跟随
        return;
      }
      let msg = `启动失败（HTTP ${res.status}）`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j?.error) msg = j.error;
      } catch {
        // 非 JSON
      }
      setLaunchError(msg);
    } catch {
      setLaunchError("网络异常，重建未启动");
    }
  }

  const note = running ? "" : launchError ?? (completed ? (completed.message ?? "") : "");
  const failed = !running && (!!launchError || (completed !== null && (completed.code === 1 || completed.code === -1)));
  const done = !running && !launchError && (completed?.code === 0 || completed?.code === 2);

  return (
    <div className="flex items-center gap-2">
      {note ? (
        <span className="max-w-[16rem] truncate text-xs text-[#8b949e]" title={note}>
          {note}
        </span>
      ) : null}
      <button
        type="button"
        onClick={run}
        disabled={running}
        title="按类目查询式重新拉取 GitHub 热榜（纯搜索、零 AI；切页不中断，回来继续显示进行中）"
        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors disabled:cursor-wait ${
          done
            ? "border-[#3fb950]/60 text-[#3fb950]"
            : failed
              ? "border-[#f85149]/60 text-[#f85149]"
              : "border-[#30363d] text-[#e6edf3] hover:border-[#58a6ff] hover:text-[#58a6ff]"
        }`}
      >
        <svg className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25.75.75 0 0 1-1.5 0 4.75 4.75 0 1 0-3.344 4.532.75.75 0 1 1 .449 1.432A6.25 6.25 0 1 1 8 1.75Z" />
          <path d="M8 1.75a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 1.75Z" />
        </svg>
        {running ? "重建中…" : "重建榜单"}
      </button>
    </div>
  );
}
