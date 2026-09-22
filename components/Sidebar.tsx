// 左侧导航侧边栏：技术热点追踪（首页聚合流）/ GitHub 热榜（存量分类榜）/ AI 智能寻找项目 / 每日 AI 洞察 / 趋势雷达。
// md+ 显示为固定左侧栏，小屏降级为顶部横向导航条（简写文案由 label 派生）。
"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { UsageBadge } from "@/components/UsageBadge";

const NAV = [
  {
    href: "/",
    label: "技术热点追踪",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden>
        <path d="M8 1.75 1.75 7.5a.75.75 0 0 0 .5 1.31H3.5v4.44c0 .41.34.75.75.75h2.75v-3.25h2.5v3.25h2.75a.75.75 0 0 0 .75-.75V8.81h1.25a.75.75 0 0 0 .5-1.31L8 1.75Z" />
      </svg>
    ),
  },
  {
    href: "/hot",
    label: "GitHub 热榜",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden>
        <path d="M2 9.25A1.25 1.25 0 0 1 3.25 8h1.5A1.25 1.25 0 0 1 6 9.25v4.5A1.25 1.25 0 0 1 4.75 15h-1.5A1.25 1.25 0 0 1 2 13.75v-4.5ZM7 4.25A1.25 1.25 0 0 1 8.25 3h1.5A1.25 1.25 0 0 1 11 4.25v9.5A1.25 1.25 0 0 1 9.75 15h-1.5A1.25 1.25 0 0 1 7 13.75v-9.5ZM12 6.75c0-.69.56-1.25 1.25-1.25s1.25.56 1.25 1.25v7A1.25 1.25 0 0 1 13.25 15 1.25 1.25 0 0 1 12 13.75v-7Z" />
      </svg>
    ),
  },
  {
    href: "/find",
    label: "AI 智能寻找项目",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden>
        <path d="M8.75 1.75a6.25 6.25 0 1 0 3.99 11.16l1.93 1.92a.75.75 0 1 0 1.06-1.06l-1.92-1.93a6.25 6.25 0 0 0-5.06-10.09Zm-4.75 6.25a4.75 4.75 0 1 1 9.5 0 4.75 4.75 0 0 1-9.5 0Z" />
      </svg>
    ),
  },
  {
    href: "/watch",
    label: "关注",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden>
        <path d="m8 1.75 1.9 3.85 4.25.62-3.07 3 .72 4.24L8 11.47l-3.8 2-0.72-4.24-3.07-3 4.25-.62L8 1.75Z" />
      </svg>
    ),
  },
  {
    href: "/compare",
    label: "对比",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden>
        <path d="M4.75 2h1.5A1.25 1.25 0 0 1 7.5 3.25v9.5A1.25 1.25 0 0 1 6.25 14h-1.5A1.25 1.25 0 0 1 3.5 12.75v-9.5C3.5 2.56 4.06 2 4.75 2Zm5 4h1.5c.69 0 1.25.56 1.25 1.25v5.5A1.25 1.25 0 0 1 11.25 14h-1.5A1.25 1.25 0 0 1 8.5 12.75v-5.5C8.5 6.56 9.06 6 9.75 6Z" />
      </svg>
    ),
  },
  {
    href: "/digest",
    label: "每日 AI 洞察",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden>
        <path d="M0 3.75A.75.75 0 0 1 .75 3h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 0 3.75Zm0 3A.75.75 0 0 1 .75 6h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 0 6.75Zm0 3A.75.75 0 0 1 .75 9h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 0 9.75ZM8.75 6.75a.75.75 0 0 1 .75-.75h5.75a.75.75 0 0 1 0 1.5H9.5a.75.75 0 0 1-.75-.75Zm0 3a.75.75 0 0 1 .75-.75h5.75a.75.75 0 0 1 0 1.5H9.5a.75.75 0 0 1-.75-.75ZM8.75 3.75a.75.75 0 0 1 .75-.75h5.75a.75.75 0 0 1 0 1.5H9.5a.75.75 0 0 1-.75-.75Z" />
      </svg>
    ),
  },
  {
    href: "/radar",
    label: "趋势雷达",
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden>
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5A5.5 5.5 0 1 1 8 13.5 5.5 5.5 0 0 1 8 2.5Zm0 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
        <path d="M8 5.5a.75.75 0 0 1 .75.75v1.69l1.03 1.03a.75.75 0 1 1-1.06 1.06L7.28 9.06A.75.75 0 0 1 7 8.5V6.25A.75.75 0 0 1 7.75 5.5h.25Z" />
      </svg>
    ),
  },
] as const;

/** 入口高亮口径：/repo 归属首页「热点」（桌面与移动统一，避免移动小屏无高亮态） */
function isNavActive(href: string, pathname: string): boolean {
  return pathname === href || (href === "/" && pathname.startsWith("/repo"));
}

function NavLinks({ pathname }: { pathname: string }) {
  return (
    <>
      {NAV.map((item) => {
        const active = isNavActive(item.href, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-[#21262d] text-[#e6edf3]"
                : "text-[#8b949e] hover:bg-[#161b22] hover:text-[#e6edf3]"
            }`}
          >
            <span className={active ? "text-[#58a6ff]" : ""}>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <>
      {/* md+ 固定左侧栏 */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[#21262d] bg-[#0d1117] px-3 py-4 md:flex">
        <Link href="/" className="mb-5 flex items-center gap-2 px-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#e6edf3]">
            <Image src="/logo.png" alt="技术信息聚合站" width={18} height={18} className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-[#e6edf3]">技术信息聚合站</span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          <NavLinks pathname={pathname} />
        </nav>

        {/* 用量统计（设置上方） */}
        <UsageBadge />

        {/* 设置入口：左下角齿轮 UI（带文字），图标与文字居中 */}
        <Link
          href="/settings"
          className={`mt-2 flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
            pathname.startsWith("/settings")
              ? "border-[#58a6ff]/50 bg-[#21262d] text-[#e6edf3]"
              : "border-[#30363d] text-[#8b949e] hover:border-[#58a6ff] hover:text-[#e6edf3]"
          }`}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden>
            <path d="M8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
            <path d="M8 1.25c-.458 0-.916.066-1.357.198l-.132.04a2 2 0 0 0-1.478 1.29l-.346.944a.25.25 0 0 1-.26.17l-1.003-.07a2 2 0 0 0-1.766.928l-.5.867a2 2 0 0 0 .207 2.22l.66.766a.25.25 0 0 1 0 .304l-.66.766a2 2 0 0 0-.207 2.22l.5.867a2 2 0 0 0 1.766.928l1.003-.07a.25.25 0 0 1 .26.17l.346.944a2 2 0 0 0 1.478 1.29l.132.04a4.06 4.06 0 0 0 2.714 0l.132-.04a2 2 0 0 0 1.478-1.29l.346-.944a.25.25 0 0 1 .26-.17l1.003.07a2 2 0 0 0 1.766-.928l.5-.867a2 2 0 0 0-.207-2.22l-.66-.766a.25.25 0 0 1 0-.304l.66-.766a2 2 0 0 0 .207-2.22l-.5-.867a2 2 0 0 0-1.766-.928l-1.003.07a.25.25 0 0 1-.26-.17l-.346-.944a2 2 0 0 0-1.478-1.29l-.132-.04A4.06 4.06 0 0 0 8 1.25Zm0 7.5a2.75 2.75 0 1 1 0-5.5 2.75 2.75 0 0 1 0 5.5Z" />
          </svg>
          设置
        </Link>
      </aside>

      {/* 小屏顶部导航条：占满可视宽度，超宽内容在条内横向滚动（不扩大文档宽度） */}
      <nav
        aria-label="主导航"
        className="hscroll-thin sticky top-0 z-40 flex w-full min-w-0 flex-nowrap items-center gap-1 overflow-x-auto border-b border-[#21262d] bg-[#0d1117]/95 px-3 py-2 backdrop-blur md:hidden"
      >
        <Link href="/" className="mr-2 flex shrink-0 items-center gap-1.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#e6edf3]">
            <Image src="/logo.png" alt="技术信息聚合站" width={16} height={16} className="h-3.5 w-3.5" />
          </span>
          <span className="whitespace-nowrap text-sm font-semibold text-[#e6edf3]">聚合</span>
        </Link>
        {NAV.map((item) => {
          const active = isNavActive(item.href, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                active ? "bg-[#21262d] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"
              }`}
            >
              {item.label
                .replace("AI 智能寻找项目", "AI 寻找")
                .replace("技术热点追踪", "热点")
                .replace("GitHub 热榜", "热榜")
                .replace("每日 AI 洞察", "洞察")
                .replace("趋势雷达", "雷达")}
            </Link>
          );
        })}
        <Link
          href="/settings"
          className={`ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors ${
            pathname.startsWith("/settings") ? "bg-[#21262d] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"
          }`}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden>
            <path d="M8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
            <path d="M8 1.25c-.458 0-.916.066-1.357.198l-.132.04a2 2 0 0 0-1.478 1.29l-.346.944a.25.25 0 0 1-.26.17l-1.003-.07a2 2 0 0 0-1.766.928l-.5.867a2 2 0 0 0 .207 2.22l.66.766a.25.25 0 0 1 0 .304l-.66.766a2 2 0 0 0-.207 2.22l.5.867a2 2 0 0 0 1.766.928l1.003-.07a.25.25 0 0 1 .26.17l.346.944a2 2 0 0 0 1.478 1.29l.132.04a4.06 4.06 0 0 0 2.714 0l.132-.04a2 2 0 0 0 1.478-1.29l.346-.944a.25.25 0 0 1 .26-.17l1.003.07a2 2 0 0 0 1.766-.928l.5-.867a2 2 0 0 0-.207-2.22l-.66-.766a.25.25 0 0 1 0-.304l.66-.766a2 2 0 0 0 .207-2.22l-.5-.867a2 2 0 0 0-1.766-.928l-1.003.07a.25.25 0 0 1-.26-.17l-.346-.944a2 2 0 0 0-1.478-1.29l-.132-.04A4.06 4.06 0 0 0 8 1.25Zm0 7.5a2.75 2.75 0 1 1 0-5.5 2.75 2.75 0 0 1 0 5.5Z" />
          </svg>
          设置
        </Link>
      </nav>
    </>
  );
}
