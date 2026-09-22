"use client";
// 右下角浮动 AI 工具的统一懒加载边界（性能）：Chat/Translate 都带 react-markdown 等重组件，
// 挂在根布局会进每个页面的共享 chunk——本包装用 dynamic + ssr:false 把它们推迟到客户端挂载后按需加载，
// 首屏 JS 与 hydration 更轻（本文档版 Next：ssr:false 只允许在 Client Component 内使用，故独立成此边界）。
// CompareTray 不在此列（自身极轻且需即时响应关注/对比状态，保留静态导入）。
import dynamic from "next/dynamic";

const ChatWidget = dynamic(() => import("./ChatWidget"), { ssr: false });
const TranslateWidget = dynamic(() => import("./TranslateWidget"), { ssr: false });

export default function FloatingWidgets() {
  return (
    <>
      <ChatWidget />
      <TranslateWidget />
    </>
  );
}
