import type { Metadata } from "next";
import "./globals.css";
import FloatingWidgets from "@/components/FloatingWidgets";
import { CompareTray } from "@/components/CompareTray";
import { Sidebar } from "@/components/Sidebar";
import { FindProvider } from "@/components/FindStore";

export const metadata: Metadata = {
  title: "技术信息聚合站",
  description: "汇总 GitHub 趋势、掘金与博客园的技术信息聚合站，含筛选与判断",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">
        {/* 小屏纵向堆叠（导航在上、主内容在下），md+ 切回横向侧栏布局；主内容恒 min-w-0 防溢出 */}
        <div className="flex min-h-screen flex-col md:flex-row">
          <Sidebar />
          {/* FindProvider 常驻：AI 寻找结果在切页后仍保留 */}
          <FindProvider>
            {/* pb-4：叠加各页自身的 pb-16，使页面末行内容在滚动到底时完全避开右下角浮动按钮（72px 占用带） */}
            <div className="w-full min-w-0 flex-1 pb-4 md:w-auto">{children}</div>
          </FindProvider>
        </div>
        {/* 浮动 AI 问答/翻译：客户端按需加载（见组件注释），不进首屏关键 JS */}
        <FloatingWidgets />
        {/* 全局对比篮浮条（非空才出现，左下角避让右下浮动按钮） */}
        <CompareTray />
      </body>
    </html>
  );
}
