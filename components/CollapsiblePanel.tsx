"use client";
// 通用可折叠面板：默认按 defaultOpen 收起/展开，点标题栏切换；grid-template-rows 平滑伸缩，
// 高度变化自然推动下方内容，保持布局整齐。供 radar 的 AI 周报、digest 首篇洞察等复用。
import { useState, type ReactNode } from "react";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden
      className={`text-[#8b949e] transition-transform duration-300 ${open ? "rotate-180" : ""}`}
    >
      <path d="M4.47 6.22 8 9.75l3.53-3.53a.75.75 0 1 1 1.06 1.06l-4.06 4.06a.75.75 0 0 1-1.06 0L3.41 7.28a.75.75 0 0 1 1.06-1.06Z" />
    </svg>
  );
}

export function CollapsiblePanel({
  title,
  subtitle,
  defaultOpen,
  titleClassName = "text-base font-semibold",
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** 默认是否展开 */
  defaultOpen: boolean;
  titleClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22]">
      {/* 标题栏：可点击切换 */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <span className={`text-[#e6edf3] ${titleClassName}`}>{title}</span>
        {subtitle && <span className="truncate text-xs text-[#8b949e]">{subtitle}</span>}
        <span className="ml-auto flex flex-none items-center gap-1 text-xs text-[#8b949e]">
          {open ? "收起" : "展开"}
          <Chevron open={open} />
        </span>
      </button>

      {/* 内容区：grid-template-rows 平滑伸缩 */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-[#21262d] px-4 pb-4 pt-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
