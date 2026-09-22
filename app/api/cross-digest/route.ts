// /api/cross-digest —— 首页「今日跨源值得看」AI 综述块（Phase 5 A；2026-09-11 后台化提速改造）。
// GET  ?date=（缺省今日）：只读当日产物 → 命中 {cached:true,content}；未命中 {cached:false,available:false}，不耗 token。
//      未命中时顺带给任务态：{running:true}=跨源综述在跑；{error:中文}=最近 10 分钟内失败过（前端轮询本接口收尾）。
// POST ?date=：**立即返回 {ok,running:true}**，拿锁与生成全部转入后台（此前同步挂住请求 1-2 分钟，易超时且体验慢）；
//      产物落 data/cross-digests/{date}.md，前端轮询 GET 获取结果或失败原因。token 门控：无 key 走 503（记入任务结果）。
// 锁 kind=cross-digest：与 GitHub 每日洞察（kind=digest）区分，避免同日两任务互相误判"已在跑"（单飞锁本身仍全局互斥）。
// M0.2：GET 命中产物时按「当前数据指纹 vs 产物 meta.sourceFingerprint」返回 freshness
//   （fresh/stale/legacy）+ meta，同日刷新数据后旧综述即标「数据已更新 · 可重新生成」；
//   后台重生成失败时（产物仍在）把失败原因随旧正文一并返回 error 字段。
//   POST 现为「（重新）生成」：force 覆盖旧产物；成功替换、失败保留旧内容。
import { NextRequest } from "next/server";
import { localDateStr } from "@/core/domain/calendar";
import { isUpdateRunning, acquireJob, finishJob, runningJob, lastJobResult, startLockHeartbeat } from "@/core/jobs/manager";
import { freshnessOf } from "@/core/domain/artifact";
import { crossDigestInput, generateCrossDigest, readCrossDigestArtifact } from "@/core/analysis/cross-digest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET 提示"最近失败"的时效：太久前的失败不再骚扰前端（用户可直接重新点生成） */
const LAST_ERROR_FRESH_MS = 10 * 60_000;

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? localDateStr();
  // 最近一次后台生成失败（10 分钟内、且晚于产物生成时间）→ 作为 genError 透出（新产物成功后不再骚扰）
  let genError: string | null = null;
  let genFailedAt = 0;
  const running = await runningJob();
  if (running?.kind !== "cross-digest") {
    const last = await lastJobResult();
    if (
      last &&
      last.kind === "cross-digest" &&
      !last.ok &&
      Date.now() - (Date.parse(last.finishedAt) || 0) < LAST_ERROR_FRESH_MS
    ) {
      genError = last.message || "生成失败";
      genFailedAt = Date.parse(last.finishedAt) || 0;
    }
  }

  const existing = await readCrossDigestArtifact(date);
  if (existing) {
    const input = await crossDigestInput(date);
    const freshness = input ? freshnessOf(existing.meta, input.sourceFingerprint) : "fresh";
    // 产物比那次失败更新（重生成已成功）→ 错误已过期
    if (genError && existing.meta && Date.parse(existing.meta.generatedAt) >= genFailedAt) {
      genError = null;
    }
    return Response.json({
      cached: true,
      freshness,
      meta: existing.meta,
      content: existing.content,
      // 后台重生成在跑时一并告知（前端保持旧正文 + 轮询等 generatedAt 变化）
      ...(running?.kind === "cross-digest" ? { running: true } : {}),
      ...(genError ? { genError } : {}),
    });
  }

  // 未命中：不自动生成（token 可控），但把后台任务态一并告知，供前端轮询收尾
  if (running?.kind === "cross-digest") {
    return Response.json({ cached: false, available: false, date, running: true });
  }
  if (genError) {
    return Response.json({ cached: false, available: false, date, error: genError });
  }
  return Response.json({ cached: false, available: false, date });
}

export async function POST(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? localDateStr();

  // 数据更新中 → 409（避免边更新边生成）
  if (await isUpdateRunning()) {
    return Response.json({ error: "数据更新中，请稍后再试" }, { status: 409 });
  }

  // 立即应答，拿锁+生成全在后台：连 acquireJob 对其它 kind 的有界排队也不挂浏览器请求；
  // 结果/失败原因经 finishJob 落任务状态，由 GET 轮询透出。
  void (async () => {
    const pid = await acquireJob("cross-digest", date);
    if (pid === null) return; // 同任务已在跑（网页/CLI 进程），让位，对方会产出文件
    const stopBeat = startLockHeartbeat(); // 持锁期间刷心跳，防热重载/闭包消亡留下僵尸锁
    let ok = true;
    let message = "已生成";
    try {
      // force：本路由是用户点按的「（重新）生成」——无视既有产物覆盖重生成；
      // cli/daily 的自动生成走自己的幂等调用（不带 force），互不影响
      const { created } = await generateCrossDigest(date, { force: true });
      message = created ? "已生成" : "本日已存在";
    } catch (err) {
      ok = false;
      message = (err as Error).message;
      console.error(`[cross-digest] 生成失败（${date}）：${message}`);
    } finally {
      stopBeat();
      await finishJob(pid, "cross-digest", ok, message, date);
    }
  })();

  return Response.json({ ok: true, running: true, date });
}
