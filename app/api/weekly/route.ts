// POST /api/weekly — 生成「上一个已完成自然周（周一~周日）」的 AI 周报（幂等）。
// 收盘日 = 上个周日（lastSunday(今天)）；周一 09:00 触发即整理上周。冷启动（未开自动）期间的更早周不在此生成。
// 走全局 AI 批任务单飞锁（lib/jobs）：数据更新中→409；同种周报已在生成→200 {ok,running:true}。
import fs from "node:fs/promises";
import path from "node:path";
import { generateWeekReview } from "@/lib/weekly";
import { lastSunday } from "@/lib/radar";
import { acquireJob, finishJob, isUpdateRunning, startLockHeartbeat } from "@/lib/jobs";
import { RADAR_DIR } from "@/lib/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function POST() {
  const endDate = lastSunday(todayLocal());
  if (!endDate) {
    return Response.json({ error: "无法确定本周收盘日" }, { status: 400 });
  }

  // 幂等：该自然周已生成 → 不再消耗 token
  const file = path.join(RADAR_DIR, `${endDate}.md`);
  try {
    await fs.readFile(file, "utf-8");
    return Response.json({ ok: true, created: false, date: endDate });
  } catch {
    // 未生成，继续
  }

  if (await isUpdateRunning()) {
    return Response.json({ error: "数据更新进行中，请稍候再生成周报" }, { status: 409 });
  }

  const pid = await acquireJob("weekly", endDate);
  if (pid === null) {
    return Response.json({ ok: true, running: true, kind: "weekly", target: endDate });
  }

  let ok = true;
  let message = "";
  const stopBeat = startLockHeartbeat(); // 持锁期间刷心跳，防热重载/闭包消亡留下僵尸锁
  try {
    const { created } = await generateWeekReview();
    message = created ? "已生成" : "本周期已存在";
    return Response.json({ ok: true, created, date: endDate });
  } catch (err) {
    ok = false;
    message = (err as Error).message;
    const status = (err as { status?: number })?.status ?? 502;
    return Response.json({ error: message }, { status });
  } finally {
    stopBeat();
    await finishJob(pid, "weekly", ok, message, endDate);
  }
}
