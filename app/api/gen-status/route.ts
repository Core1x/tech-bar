// GET /api/gen-status — AI 批任务(洞察/周报)当前状态：running 为真实在跑的任务(null=空闲)，last 为上次结果。
// 供 digest/radar 页面与生成按钮轮询：任务结束时自动刷新页面即可看到产物。
import { runningJob, lastJobResult } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ running: await runningJob(), last: await lastJobResult() });
}
