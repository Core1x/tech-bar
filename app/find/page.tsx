// /find — AI 智能寻找项目（自然语言描述需求 → AI 转搜索 → 开源/非开源过滤 → AI 推荐）
import { ProjectFinder } from "@/components/ProjectFinder";
import { hasDeepSeekKey } from "@/lib/deepseek";

export const dynamic = "force-dynamic";

export default async function FindPage() {
  const hasKey = await hasDeepSeekKey();
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-16">
      <header className="flex items-center justify-between border-b border-[#21262d] py-4">
        <div>
          <h1 className="text-xl font-bold text-[#e6edf3]">AI 智能寻找项目</h1>
          <p className="mt-0.5 text-xs text-[#8b949e]">
            用一句话描述你想找的项目，AI 帮你从 GitHub 上找到匹配的开源仓库
          </p>
        </div>
      </header>

      <ProjectFinder hasKey={hasKey} />
    </main>
  );
}
