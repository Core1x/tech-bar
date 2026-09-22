// POST /api/digest — 生成今日洞察（幂等：今日已存在则跳过，不重复消耗 token）。
// ?force=1（M4 §10.2「数据已更新 · 可重新生成」）：无视既有产物覆盖重生成（锁与用量语义不变）。
// 走全局 AI 批任务单飞锁（lib/jobs）：数据更新中→409；同一种洞察已在生成→200 {ok,running:true}
//（对方在生成同一文件，页面轮询状态、完成后自动刷新即可）；拿锁成功→真正生成→finishJob。
import { NextRequest } from "next/server";
import { generateTodayDigest, localDateStr } from "@/lib/digest";
import { acquireJob, finishJob, isUpdateRunning, startLockHeartbeat } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const dateStr = localDateStr();
  const force = req.nextUrl.searchParams.get("force") === "1";

  if (await isUpdateRunning()) {
    return Response.json({ error: "数据更新进行中，请稍候再生成洞察" }, { status: 409 });
  }

  const pid = await acquireJob("digest", dateStr);
  if (pid === null) {
    // 另一进程/请求正在生成同一日洞察：不重复生成，告诉前端去轮询
    return Response.json({ ok: true, running: true, kind: "digest", target: dateStr });
  }

  let ok = true;
  let message = "";
  const stopBeat = startLockHeartbeat(); // 持锁期间刷心跳，防热重载/闭包消亡留下僵尸锁
  try {
    const { created } = await generateTodayDigest(dateStr, { force });
    message = created ? "已生成" : "本日已存在";
    return Response.json({ ok: true, created, date: dateStr });
  } catch (err) {
    ok = false;
    message = (err as Error).message;
    const status = (err as { status?: number })?.status ?? 502;
    return Response.json({ error: message }, { status });
  } finally {
    stopBeat();
    await finishJob(pid, "digest", ok, message, dateStr);
  }
}
