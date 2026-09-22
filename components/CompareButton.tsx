"use client";
// 「加入对比」按钮（M3 §9.4 各入口共用）：切换某 GitHub 仓库在对比篮中的状态。
// 满 4 且未含本仓时禁用并提示；已在篮中显示高亮「对比中」。文案随 useSyncExternalStore 实时联动（多处同步）。
import { useSyncExternalStore } from "react";
import { COMPARE_MAX, getCompareServerSnapshot, getCompareSnapshot, subscribeCompare, toggleCompare } from "./compareStore";

export function CompareButton({ fullName, label = "加入对比" }: { fullName: string; label?: string }) {
  const basket = useSyncExternalStore(subscribeCompare, getCompareSnapshot, getCompareServerSnapshot);
  const inBasket = basket.includes(fullName);
  const full = basket.length >= COMPARE_MAX && !inBasket;
  return (
    <button
      type="button"
      onClick={() => toggleCompare(fullName)}
      disabled={full}
      title={full ? `对比篮已满（最多 ${COMPARE_MAX} 个），先到对比页移除` : inBasket ? "移出对比篮" : "加入本地对比篮（最多 4 个 GitHub 仓库）"}
      className={
        "shrink-0 rounded-md border px-2.5 py-1 text-xs transition-colors " +
        (inBasket
          ? "border-[#58a6ff]/50 bg-[#58a6ff]/15 text-[#58a6ff]"
          : full
            ? "cursor-not-allowed border-[#30363d] text-[#484f58]"
            : "border-[#30363d] text-[#8b949e] hover:border-[#58a6ff] hover:text-[#58a6ff]")
      }
    >
      {inBasket ? "✓ 对比中" : full ? "对比篮已满" : `+ ${label}`}
    </button>
  );
}
