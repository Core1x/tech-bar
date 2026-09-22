"use client";
// 全局浮动对比条（M3 §9.4）：对比篮非空时出现在左下角，显示已选数量与仓库，点击进 /compare，可一键清空。
// 放在左下角避开右下角的 AI 问答/翻译浮动按钮（§12.4 不叠加遮挡）；
// 桌面端左偏移让开固定侧栏（w-60=15rem，留 1.5rem 间隙），小屏侧栏不存在贴边即可。
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { COMPARE_MAX, clearCompare, getCompareServerSnapshot, getCompareSnapshot, removeFromCompare, subscribeCompare } from "./compareStore";

export function CompareTray() {
  const basket = useSyncExternalStore(subscribeCompare, getCompareSnapshot, getCompareServerSnapshot);
  if (basket.length === 0) return null;
  return (
    <div className="fixed bottom-5 left-4 z-40 max-w-[calc(100vw-2.5rem)] rounded-xl border border-[#30363d] bg-[#161b22] p-3 shadow-2xl md:left-[16.5rem]">
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-full bg-[#58a6ff]/15 px-2 py-0.5 text-xs font-medium text-[#58a6ff]">
          对比篮 {basket.length}/{COMPARE_MAX}
        </span>
        <Link
          href="/compare"
          className="rounded-md bg-[#238636] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#2ea043]"
        >
          去对比 →
        </Link>
        <button onClick={clearCompare} className="text-xs text-[#8b949e] transition-colors hover:text-[#f85149]" title="清空对比篮">
          清空
        </button>
      </div>
      <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto">
        {basket.map((n) => (
          <li key={n} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-[#c9d1d9]" title={n}>{n}</span>
            <button onClick={() => removeFromCompare(n)} className="shrink-0 text-[#8b949e] hover:text-[#f85149]" aria-label={`移出 ${n}`}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
