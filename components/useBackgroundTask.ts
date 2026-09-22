"use client";
// 刷新类后台任务（POST 起 detached 子进程 + GET 回查 {running, progress?, lastResult}）的前端通用状态机。
// 观感一致性契约：
//  - 挂载即回查：任务若已在跑（切页返回 / 其它标签页触发 / 定时任务进行中），按钮直接进入运行态并继续轮询，
//    进度取服务端进度文件 → 与真实执行进度统一，不重置、不闪 idle；
//  - completed 仅在「观测到 running→结束」迁移时置值：避免挂载时把更早一次（如今早定时任务）的 lastResult
//    误当"刚完成"而刷新页面；
//  - begin()：POST 受理后立即进入运行态并重启轮询循环（不等首次 GET，防按钮闪 idle）；
//  - 网络抖动/非 200：运行中按 2× 退避重探，空闲时不打扰后台。
import { useCallback, useEffect, useRef, useState } from "react";

export interface BackgroundTaskResult {
  code: number;
  message: string | null;
  finishedAt?: string | null;
}
export interface BackgroundTaskProgress {
  stage: string;
  done: number;
  total: number;
}
interface Snapshot {
  running?: boolean;
  progress?: BackgroundTaskProgress | null;
  lastResult?: BackgroundTaskResult | null;
}

/**
 * @param url 任务态 GET 端点（如 /api/update、/api/hot）
 * @param intervalMs 运行中的轮询间隔（默认 2500）
 */
export function useBackgroundTask(
  url: string,
  intervalMs = 2500,
): {
  running: boolean;
  /** 服务端任务进度（无进度文件的任务恒 null，按钮自行降级为不确定态） */
  progress: BackgroundTaskProgress | null;
  /** 本轮观测到的任务结果（running→结束 时才非空） */
  completed: BackgroundTaskResult | null;
  /** POST 受理后调用：立即置运行态 + 重启轮询 */
  begin: () => void;
} {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BackgroundTaskProgress | null>(null);
  const [completed, setCompleted] = useState<BackgroundTaskResult | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasRunningRef = useRef(false);
  const startRef = useRef<() => void>(() => {});

  useEffect(() => {
    let stopped = false;
    const arm = (ms: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (!stopped) timerRef.current = setTimeout(() => void poll(), ms);
    };
    const poll = async () => {
      if (stopped) return;
      let s: Snapshot | null = null;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) s = (await res.json()) as Snapshot;
      } catch {
        // 网络抖动 → s 留 null，按退避处理
      }
      if (stopped) return;
      if (s?.running) {
        wasRunningRef.current = true;
        setRunning(true);
        setProgress(s.progress ?? null);
        arm(intervalMs);
        return;
      }
      setRunning(false);
      setProgress(null);
      if (wasRunningRef.current) {
        wasRunningRef.current = false;
        setCompleted(s?.lastResult ?? { code: -1, message: null }); // 观测到结束
      } else if (s === null) {
        arm(intervalMs * 2); // 查询失败且不在运行：退避再探一次；仍失败则静默（下次挂载重新回查）
      }
      // s 存在且不在运行：任务空闲态，结束轮询（等 begin() 重新驱动）
    };
    startRef.current = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void poll();
    };
    void poll(); // 挂载回查
    return () => {
      stopped = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [url, intervalMs]);

  const begin = useCallback(() => {
    wasRunningRef.current = true;
    setRunning(true);
    setProgress(null);
    setCompleted(null);
    startRef.current();
  }, []);

  return { running, progress, completed, begin };
}
