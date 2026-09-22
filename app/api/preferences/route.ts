// /api/preferences —— M5 §11.3 兴趣偏好（data/config/preferences.json，本地单用户）。
// GET 返回全量偏好；POST 合并写回（清洗校验见 core/config/preferences）。
// 边界（设置页同步声明）：偏好只影响「今日必须看」的候选加权，不改变原始榜单与完整信息流。
import { NextRequest } from "next/server";
import { readPreferences, sanitizePreferences, writePreferences } from "@/core/config/preferences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ ok: true, preferences: await readPreferences() });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const partial = sanitizePreferences(body);
  const next = await writePreferences(partial);
  return Response.json({ ok: true, preferences: next });
}
