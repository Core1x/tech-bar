// /api/watchlist —— 跨源关注（Phase 4 聚合首页，architecture.md §4.10）。
// GET  返回全量关注条目（key = `${source}:${source_id}`）；
// POST body {source, source_id} 切换关注（在则移除，不在则追加），返回最新状态与全量清单。
import { NextRequest } from "next/server";
import { readWatchlist, toggleWatchlist, watchlistKey } from "@/core/store/file";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const items = await readWatchlist();
  return Response.json({ items, keys: items.map((e) => watchlistKey(e.source, e.source_id)) });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const { source, source_id, snapshot } = (body ?? {}) as {
    source?: unknown;
    source_id?: unknown;
    snapshot?: unknown;
  };
  if (typeof source !== "string" || source.trim() === "") {
    return Response.json({ error: "source 必须是字符串" }, { status: 400 });
  }
  if (typeof source_id !== "string" || source_id.trim() === "") {
    return Response.json({ error: "source_id 必须是字符串" }, { status: 400 });
  }

  // M2：加入关注时前端可带展示快照（离开榜单后关注页仍可解释）；宽松消毒——非法形状直接忽略，不拒绝整个请求
  const snap = snapshot as Record<string, unknown> | undefined;
  const cleanSnapshot =
    snap && typeof snap === "object" && typeof snap.title === "string" && typeof snap.url === "string"
      ? {
          title: String(snap.title).slice(0, 200),
          url: String(snap.url).slice(0, 500),
          description: typeof snap.description === "string" ? snap.description.slice(0, 300) : null,
          lastMetricLabel: typeof snap.lastMetricLabel === "string" ? snap.lastMetricLabel.slice(0, 60) : null,
          capturedAt: typeof snap.capturedAt === "string" ? snap.capturedAt : new Date().toISOString(),
        }
      : undefined;

  const { added, items } = await toggleWatchlist(source.trim(), source_id.trim(), cleanSnapshot);
  return Response.json({
    ok: true,
    added,
    watched: added, // 当前是否处于关注态
    source: source.trim(),
    source_id: source_id.trim(),
    items,
  });
}
