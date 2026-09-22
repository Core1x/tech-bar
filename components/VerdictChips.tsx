// 判读条 chips 渲染器：确定性信号（lib/signals.ts）的可视化。
// 无 "use client"、无 hooks、纯展示 —— 可被服务端组件直接渲染，也能嵌进客户端组件树。
// chips 为空（含全被 hideKinds 过滤）→ 返回 null，不占版面。
import type { ReactNode } from "react";
import { computeSignals, type VerdictSource, type ChipTone, type ChipKind } from "@/lib/signals";

const TONE_CLASS: Record<ChipTone, string> = {
  red: "border-[#f85149]/40 bg-[#f85149]/10 text-[#f85149]",
  amber: "border-[#d29922]/40 bg-[#d29922]/10 text-[#d29922]",
  green: "border-[#3fb950]/40 bg-[#3fb950]/10 text-[#3fb950]",
};

export function VerdictChips({
  repo,
  className,
  hideKinds,
}: {
  repo: VerdictSource;
  className?: string;
  /** 不展示的信号类型（如新星榜隐藏必绿的 active、寻找结果隐藏与许可证 pill 重复的 no-license） */
  hideKinds?: ChipKind[];
}): ReactNode {
  const { chips } = computeSignals(repo);
  if (chips.length === 0) return null;
  const hidden = new Set(hideKinds ?? []);
  const shown = chips.filter((c) => !hidden.has(c.kind));
  if (shown.length === 0) return null;

  return (
    <div className={"flex flex-wrap items-center gap-1.5 " + (className ?? "")}>
      {shown.map((c) => (
        <span
          key={c.kind}
          title={c.detail}
          className={"rounded-full border px-2 py-0.5 text-xs " + TONE_CLASS[c.tone]}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}
