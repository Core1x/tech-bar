// /api/sources —— M5 §11.2 数据源管理（写现有 data/config/active-sources.json，不另建重复配置）。
// GET：全部可用源（registry）+ 是否启用 + 最后成功更新时间（读各源今日快照时间戳；无文件=从未拉取）
//       + 网络要求说明（registry.networkHint）。
// POST { active: string[] }：启用/停用（校验子集、非空；顺序按 registry 稳定化）。
import { NextRequest } from "next/server";
import { ALL_SOURCES } from "@/core/sources/registry";
import { readActiveSources, writeActiveSources } from "@/core/config/sources";
import { readLatest, readSourceLatest } from "@/core/store/file";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SourceLatestLike {
  fetched_at?: string;
}

async function lastSuccessAt(id: string): Promise<string | null> {
  try {
    if (id === "github") return (await readLatest())?.updated_at ?? null;
    const latest = await readSourceLatest<SourceLatestLike>(id);
    return latest?.fetched_at ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const active = await readActiveSources();
  const sources = await Promise.all(
    ALL_SOURCES.map(async (s) => ({
      id: s.id,
      label: s.label,
      active: active.includes(s.id),
      lastSuccessAt: await lastSuccessAt(s.id),
      networkHint: s.networkHint ?? "国内直连",
    })),
  );
  return Response.json({ ok: true, sources });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const { active } = (body ?? {}) as { active?: unknown };
  if (!Array.isArray(active) || active.some((x) => typeof x !== "string")) {
    return Response.json({ error: "active 必须是字符串数组" }, { status: 400 });
  }
  const known = new Set(ALL_SOURCES.map((s) => s.id));
  const cleaned = ALL_SOURCES.filter((s) => (active as string[]).includes(s.id)).map((s) => s.id);
  const unknown = (active as string[]).filter((x) => !known.has(x));
  if (unknown.length > 0) {
    return Response.json({ error: `未知数据源：${unknown.join("、")}` }, { status: 400 });
  }
  if (cleaned.length === 0) {
    return Response.json({ error: "至少保留一个启用源（否则首页信息流为空）" }, { status: 400 });
  }
  await writeActiveSources(cleaned);
  return Response.json({ ok: true, active: cleaned });
}
