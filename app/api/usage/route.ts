// GET /api/usage — 侧边栏用量统计：AI token 今日用量 + GitHub API 配额余量
// AI 用量来自本地累积（data/cache/ai-usage.json）；GitHub 配额来自 /rate_limit（不计费）
import { ghGetJson } from "@/lib/github";
import { readAiUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const [ai, gh] = await Promise.all([
    readAiUsage(),
    // GitHub 网络可能抖动：重试一次，仍失败返回 null（前端显示降级，不 500）
    (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await ghGetJson<{
            resources?: {
              core?: { limit?: number; remaining?: number };
              search?: { limit?: number; remaining?: number };
            };
          }>("/rate_limit");
        } catch {
          if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
        }
      }
      return null;
    })(),
  ]);

  return Response.json({
    ai: {
      prompt: ai.prompt,
      completion: ai.completion,
      total: ai.prompt + ai.completion,
    },
    github: gh?.data
      ? {
          coreRemaining: gh.data.resources?.core?.remaining ?? null,
          coreLimit: gh.data.resources?.core?.limit ?? null,
          searchRemaining: gh.data.resources?.search?.remaining ?? null,
        }
      : null,
  });
}
