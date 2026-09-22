// /compare 项目对比页（M3 §9.5）：对比篮（localStorage）→ 零 AI 事实矩阵 → 可选 AI 场景建议。
// 服务端只判 AI key 有无并下传；矩阵数据由 CompareBoard 客户端按需 GET /api/compare。
import { createDeepSeekProvider } from "@/core/ai/provider";
import { CompareBoard } from "@/components/CompareBoard";

export const dynamic = "force-dynamic";

export default async function ComparePage() {
  const hasKey = await createDeepSeekProvider().hasKey();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16">
      <CompareBoard hasKey={hasKey} />
    </main>
  );
}
