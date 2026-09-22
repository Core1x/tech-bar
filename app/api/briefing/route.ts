// /api/briefing —— M1「今日必须看」简报的只读探测与 AI 推荐语生成入口（product-optimization-plan §7）。
// GET ?date=（缺省今日）：peek —— 确定性选择现算 + 有新鲜 AI 缓存则合并推荐语；零 token、零生成。
// POST ?date=：为已选候选生成 AI 推荐语并落缓存（token 消耗只在这里；数据更新中 409；无 key 503）。
// 候选/依据本身是确定性能力（GET 已直出），POST 只是「解释」的升级 —— 无 AI Key 时 GET 仍返回完整简报。
import { NextRequest } from "next/server";
import { localDateStr } from "@/core/domain/calendar";
import { isUpdateRunning } from "@/core/jobs/manager";
import { peekBriefing, generateBriefing } from "@/core/analysis/briefing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? localDateStr();
  try {
    const resp = await peekBriefing(date);
    return Response.json(resp);
  } catch (err) {
    return Response.json({ error: (err as Error).message || "简报读取失败" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? localDateStr();
  if (await isUpdateRunning()) {
    return Response.json({ error: "数据更新中，请稍后再试" }, { status: 409 });
  }
  try {
    const resp = await generateBriefing(date);
    return Response.json(resp);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 502;
    return Response.json({ error: (err as Error).message || "简报生成失败" }, { status });
  }
}
