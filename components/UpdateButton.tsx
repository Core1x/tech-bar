// 「刷新趋势数据」按钮：圆圈刷新箭头图标（浏览器式）+ 悬停提示 + 左侧进度条。
// 点击后任务在服务端后台执行（detached 子进程）；状态统一走 useBackgroundTask("/api/update")——
// 挂载即回查：切页离开再回来时，若后台仍在跑则按钮自动恢复运行态与进度条（进度取服务端进度文件，不重置）。
"use client";
import { useEffect, useState } from "react";
import { useBackgroundTask } from "./useBackgroundTask";

export function UpdateButton() {
  const { running, progress, completed, begin } = useBackgroundTask("/api/update");
  // POST 受理失败只在事件处理器里置值；completed（观测到任务结束）直接派生展示，effect 不 setState
  const [launchError, setLaunchError] = useState<string | null>(null);

  // 成功 → 短暂「已更新」后刷新展示新数据（仅定时器，无 setState）
  useEffect(() => {
    if (completed?.code === 0) {
      const t = setTimeout(() => window.location.reload(), 1200);
      return () => clearTimeout(t);
    }
  }, [completed]);

  async function run() {
    if (running) return;
    setLaunchError(null);
    try {
      const res = await fetch("/api/update", { method: "POST" });
      if (res.ok || res.status === 409) {
        begin(); // 409 = 已有任务在跑（别的标签页/定时任务）→ 直接跟随其进度
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
      setLaunchError("网络异常，更新未启动");
    }
  }

  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;
  const note = !running ? launchError ?? (completed ? completed.message ?? "" : "") : "";
  const failed = !running && (!!launchError || (completed !== null && completed.code !== 0));
  const done = !running && !launchError && completed?.code === 0;

  return (
    <div className="relative flex items-center gap-3">
      {/* 左侧进度条：有进度数据时显示百分比，否则滑动占位（跨页面返回后由挂载回查自动恢复） */}
      {running && (
        <div className="flex items-center gap-2">
          <div
            className="relative h-1 w-24 overflow-hidden rounded-full bg-[#21262d] sm:w-36"
            role="progressbar"
            aria-label="正在刷新趋势数据"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
          >
            {pct !== null ? (
              <div
                className="h-full rounded-full bg-[#58a6ff] transition-[width] duration-500 ease-out"
                style={{ width: `${pct}%` }}
              />
            ) : (
              <div className="progress-indeterminate h-full w-1/3 rounded-full bg-[#58a6ff]" />
            )}
          </div>
          {pct !== null && <span className="hidden text-xs tabular-nums text-[#8b949e] sm:inline">{pct}%</span>}
        </div>
      )}

      {/* 圆圈刷新按钮 + 悬停提示 */}
      <div className="group relative">
        <button
          onClick={run}
          disabled={running}
          title={running ? "正在后台刷新（切页不中断，回来继续显示进度）" : "刷新趋势数据"}
          aria-label="刷新趋势数据"
          className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed ${
            done
              ? "border-[#3fb950]/60 text-[#3fb950]"
              : failed
                ? "border-[#f85149]/60 text-[#f85149]"
                : "border-[#30363d] text-[#e6edf3] hover:border-[#58a6ff] hover:text-[#58a6ff]"
          }`}
        >
          <svg className={`h-4 w-4 ${running ? "animate-spin" : ""}`} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25.75.75 0 0 1-1.5 0 4.75 4.75 0 1 0-3.344 4.532.75.75 0 1 1 .449 1.432A6.25 6.25 0 1 1 8 1.75Z" />
            <path d="M8 1.75a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 1.75Z" />
            <path d="M8.53 4.97a.75.75 0 0 1 0 1.06L6.56 8l1.97 1.97a.75.75 0 1 1-1.06 1.06L5.22 8.53a.75.75 0 0 1 0-1.06l2.25-2.25a.75.75 0 0 1 1.06 0Z" />
          </svg>
        </button>

        {/* 悬停提示：位于按钮下方；有结果提示时隐藏，避免两者重叠 */}
        <span
          className={`pointer-events-none absolute left-1/2 top-full z-40 mt-2 -translate-x-1/2 whitespace-nowrap rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-[#e6edf3] shadow-lg transition-opacity ${
            note ? "opacity-0" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          刷新趋势数据
        </span>
      </div>

      {/* 结果提示（成功 / 失败）：同样位于按钮下方 */}
      {note && (
        <span className="pointer-events-none absolute left-1/2 top-full z-40 mt-2 -translate-x-1/2 whitespace-nowrap rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-[#8b949e] shadow-lg">
          {note}
        </span>
      )}
    </div>
  );
}
