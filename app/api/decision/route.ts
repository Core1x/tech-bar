// GET /api/decision?repo=owner/name[&peek=1] — M3 项目决策卡。
// peek=1：只读（确定性事实+结论+风险每次现算；AI 解释读缓存并判新鲜度），零 token。
// 非 peek：确保有当前输入的解释——命中直接返回，未命中调 AI 生成（无 key → genError 形态，
// 确定性部分照常展示；失败但有旧版 → 保留旧解释 + genError）。错误 shape {error:中文} 与既有 AI 路由一致。
import { NextRequest } from "next/server";
import { peekDecision, generateDecision } from "@/lib/decision";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get("repo") ?? "";
  if (!REPO_PATTERN.test(repo)) {
    return Response.json({ error: "repo 参数不合法，格式应为 owner/name" }, { status: 400 });
  }
  const peek = req.nextUrl.searchParams.get("peek") === "1";
  try {
    const resp = peek ? await peekDecision(repo) : await generateDecision(repo);
    return Response.json(resp);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 502;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
