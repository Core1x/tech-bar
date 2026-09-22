// cli/daily.ts — 每日一键薄入口（取代 scripts/daily.mjs）：数据 → 摘要 → 洞察 → 周报自动。
// 编排逻辑从 daily.mjs 迁 core/cli：update 引擎=core/sources/github；生成器=core/analysis 或现 lib 单源；
// 开关=core/config/features；锁=core/jobs/manager；周锚点=core/config/weekly-anchor。
// 用法：node dist/cli/daily.mjs [--force]（force：强制重生成当日洞察）
// 退出码：0 成功 / 1 有步骤失败（更新限流退出码 2 视为警告，不中断后续）。
import fs from "node:fs/promises";
import path from "node:path";
import { loadCliEnv } from "../core/config/env";
import { addDays, lastSunday, localDateStr, mondayOf } from "../core/domain/calendar";
import { DIGESTS_DIR } from "../lib/data";
import { runUpdateTrending } from "../core/sources/github/updater";
import { readActiveSources } from "../core/config/sources";
import { sourceById } from "../core/sources/registry";
import { runSummarizeNewStars, runSummarizeHot } from "../core/analysis/summarize";
import { rebuildHotSnapshot } from "../core/sources/github/hot";
import { createDeepSeekProvider } from "../core/ai/provider";
import { acquireJob, finishJob, startLockHeartbeat } from "../core/jobs/manager";
import { readFeatures } from "../core/config/features";
import { readWeeklyAnchor, writeWeeklyAnchor } from "../core/config/weekly-anchor";
import { generateTodayDigest } from "../lib/digest";
import { generateWeekReview } from "../lib/weekly";
import { generateCrossDigest } from "../core/analysis/cross-digest";
import { generateCrossWeekly } from "../lib/cross-weekly";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function hasAiKey(): Promise<boolean> {
  return createDeepSeekProvider().hasKey();
}

async function main() {
  loadCliEnv();
  const featureFlags = await readFeatures();
  const todayStr = localDateStr();
  const force = process.argv.includes("--force");
  const warnings: string[] = [];
  const errors: string[] = [];

  // 步骤 1：更新数据（限流退出码 2 = 已保存部分，不中断后续）
  console.log(`=== 步骤 1/4：更新数据（${todayStr}）===`);
  let dataCode: number;
  try {
    dataCode = await runUpdateTrending();
  } catch (e) {
    errors.push(`数据更新异常：${errMsg(e)}`);
    dataCode = 1;
  }
  if (dataCode === 2) {
    warnings.push("数据更新因限流提前停止（退出码 2），已完成部分已保存，稍后可重跑补齐");
  } else if (dataCode !== 0) {
    errors.push(`数据更新失败（退出码 ${dataCode}）`);
  }

  // 步骤 1.5：拉取「非 github 的启用源」（掘金/博客园/…；HN 默认关）。非致命，一源失败仅告警
  const activeSources = await readActiveSources();
  console.log(`=== 步骤 1.5/4：辅助源（${activeSources.filter((s) => s !== "github").join("、") || "无"}）===`);
  for (const id of activeSources) {
    if (id === "github") continue; // github 已在步骤 1
    const def = sourceById(id);
    if (!def) {
      warnings.push(`未知启用源「${id}」跳过`);
      continue;
    }
    try {
      const r = await def.adapter.run({});
      console.log(`[${def.label}] ${r.ok ? "成功" : "失败"}：${r.message ?? ""}`);
      if (!r.ok) warnings.push(`${def.label} 拉取失败：${r.message ?? ""}`);
    } catch (e) {
      warnings.push(`${def.label} 拉取异常：${errMsg(e)}`);
    }
  }

  // 步骤 1.6：GitHub 热榜重建（存量榜 /hot；纯 searchRepos、零 AI；约 20 笔查询式）。
  // 无类目配置 → code 1（仅提示，不算失败）；限流 → code 2（已落部分快照，视为警告）。非致命。
  console.log("=== 步骤 1.6：GitHub 热榜重建 ===");
  try {
    const hr = await rebuildHotSnapshot();
    console.log(`[热榜] ${hr.message}`);
    if (hr.code === 2) warnings.push(`热榜重建部分完成（限流）：${hr.message}`);
    else if (hr.code !== 0) console.log(`[热榜] 跳过重建：${hr.message}`);
  } catch (e) {
    warnings.push(`热榜重建异常：${errMsg(e)}`);
  }

  // 步骤 2：中文摘要（需 key）
  console.log("=== 步骤 2/4：中文摘要 ===");
  if (!(await hasAiKey())) {
    console.log("[摘要] 未配置 DEEPSEEK_API_KEY，跳过（榜单显示原文描述）");
  } else {
    try {
      const r = await runSummarizeNewStars();
      console.log(`[摘要] ${r.message}`);
    } catch (e) {
      errors.push(`摘要生成失败：${errMsg(e)}`);
    }
    // 热榜摘要增量补全（单次有上限、幂等可续跑；token 可控）
    try {
      const rh = await runSummarizeHot();
      console.log(`[摘要·热榜] ${rh.message}`);
    } catch (e) {
      warnings.push(`热榜摘要生成失败：${errMsg(e)}`);
    }
  }

  // 步骤 3：每日洞察（需 key + 开关「自动生成 AI 日报」；批任务单飞锁互斥）
  console.log("=== 步骤 3/4：每日洞察 ===");
  if (!(await hasAiKey())) {
    console.log("[洞察] 未配置 DEEPSEEK_API_KEY，跳过");
  } else if (!featureFlags.autoDailyInsight) {
    console.log("[洞察] 功能设置已关闭「自动生成 AI 日报」，跳过（可到 /digest 手动生成）");
  } else {
    const jobPid = await acquireJob("digest", todayStr);
    if (jobPid === null) {
      console.log("[洞察] 已有 AI 批任务在生成（网页/另一进程），本次跳过，完成后可见");
    } else {
      let ok = true;
      let msg = "已生成";
      const stopBeat = startLockHeartbeat(); // 持锁期间刷心跳（锁僵尸回收依赖 mtime 新鲜）
      try {
        if (force) {
          // --force：先删当日已有洞察，令 generateTodayDigest 重新生成（幂等检查见不到文件）
          try {
            await fs.unlink(path.join(DIGESTS_DIR, `${todayStr}.md`));
          } catch {
            // 不存在即可
          }
        }
        const { created } = await generateTodayDigest(todayStr);
        msg = created ? "已生成" : "本日已存在";
        console.log(`[洞察] ${msg} data/digests/${todayStr}.md`);
      } catch (e) {
        ok = false;
        msg = `生成失败：${errMsg(e)}`;
        errors.push(`洞察生成失败：${errMsg(e)}`);
      } finally {
        stopBeat();
        await finishJob(jobPid, "digest", ok, msg, todayStr);
      }
    }
  }

  // 步骤 4：AI 周报自动（需 key + 开关；自然周 周一~周日，周一收上周；冷启动锚点不回补更早周）
  console.log("=== 步骤 4/4：AI 周报（自动：整理上一自然周 周一~周日） ===");
  if (!(await hasAiKey())) {
    console.log("[周报] 未配置 DEEPSEEK_API_KEY，跳过（可到 /radar 手动生成）");
  } else if (!featureFlags.autoWeeklyReport) {
    console.log("[周报] 功能设置已关闭「自动生成 AI 周报」，跳过（可到 /radar 手动生成）");
  } else {
    const dueDate = lastSunday(todayStr); // 上一已完成自然周的收盘日（周日）
    const dueMon = addDays(dueDate, -6); // 该周周一
    const anchor = await readWeeklyAnchor();
    if (!anchor) {
      const startMon = mondayOf(todayStr);
      await writeWeeklyAnchor(startMon);
      console.log(`[周报] 冷启动：从 ${startMon}（周一）周起统计`);
    } else if (dueMon < anchor.monday) {
      console.log(`[周报] 首份完整周将在 ${anchor.monday} 周结束后的下周一生成；本次跳过（不回补更早的自然周）`);
    } else {
      const jobPid = await acquireJob("weekly", dueDate);
      if (jobPid === null) {
        console.log("[周报] 已有 AI 批任务在生成（网页/另一进程），本次跳过，完成后可见");
      } else {
        let ok = true;
        let msg = "已自动生成";
        const stopBeat = startLockHeartbeat(); // 持锁期间刷心跳（锁僵尸回收依赖 mtime 新鲜）
        try {
          const { created } = await generateWeekReview();
          msg = created ? "已自动生成" : "本周期已存在";
          console.log(`[周报] ${msg} data/radar/${dueDate}.md`);
        } catch (e) {
          ok = false;
          msg = `生成失败：${errMsg(e)}`;
          warnings.push(`周报自动生成失败：${errMsg(e)}`);
        } finally {
          stopBeat();
          await finishJob(jobPid, "weekly", ok, msg, dueDate);
        }
      }
    }
  }

  // 步骤 5：跨源 AI 综述（每日）+ 跨源周报（Phase 5 A/C；需 key + 开关；批任务单飞锁）
  console.log("=== 步骤 5/4：跨源综述 ===");
  if (!(await hasAiKey())) {
    console.log("[跨源] 未配置 DEEPSEEK_API_KEY，跳过");
  } else if (!featureFlags.autoCrossDigest) {
    console.log("[跨源] 功能设置已关闭「自动生成跨源综述」，跳过");
  } else {
    // 跨源每日综述（kind=cross-digest：与 web /api/cross-digest 同一把锁同一 target 互斥；
    //  不再复用洞察的 "digest" kind，避免同日两任务互相误判"已在跑"；与其它 AI 批任务仍全局互斥）
    let crossOk = true;
    let crossMsg = "已生成";
    try {
      const pid = await acquireJob("cross-digest", todayStr);
      if (pid === null) {
        console.log("[跨源·每日] 已有 AI 批任务在生成，本次跳过");
      } else {
        const stopBeat = startLockHeartbeat(); // 持锁期间刷心跳（锁僵尸回收依赖 mtime 新鲜）
        try {
          const { created } = await generateCrossDigest(todayStr);
          crossMsg = created ? "已生成" : "本日已存在";
          console.log(`[跨源·每日] ${crossMsg} data/cross-digests/${todayStr}.md`);
        } finally {
          stopBeat();
          await finishJob(pid, "cross-digest", crossOk, crossMsg, todayStr);
        }
      }
    } catch (e) {
      crossOk = false;
      crossMsg = `生成失败：${errMsg(e)}`;
      warnings.push(`跨源综述生成失败：${errMsg(e)}`);
    }

    // 跨源周报（自然周，周一收上周；独立 kind=cross-weekly）
    const crossEnd = lastSunday(todayStr);
    try {
      const pid = await acquireJob("cross-weekly", crossEnd);
      if (pid === null) {
        console.log("[跨源·周报] 已有 AI 批任务在生成，本次跳过");
      } else {
        let wkOk = true;
        let wkMsg = "已自动生成";
        const stopBeat = startLockHeartbeat(); // 持锁期间刷心跳（锁僵尸回收依赖 mtime 新鲜）
        try {
          const { created, file } = await generateCrossWeekly();
          wkMsg = created ? "已自动生成" : "本周期已存在";
          console.log(`[跨源·周报] ${wkMsg} ${file}`);
        } catch (e) {
          wkOk = false;
          wkMsg = `生成失败：${errMsg(e)}`;
          warnings.push(`跨源周报生成失败：${errMsg(e)}`);
        } finally {
          stopBeat();
          await finishJob(pid, "cross-weekly", wkOk, wkMsg, crossEnd);
        }
      }
    } catch (e) {
      warnings.push(`跨源周报异常：${errMsg(e)}`);
    }
  }

  // 报告
  console.log("\n=== 运行报告 ===");
  for (const w of warnings) console.warn(`[警告] ${w}`);
  for (const e of errors) console.error(`[失败] ${e}`);
  if (errors.length === 0) {
    console.log(`[完成] 全部步骤成功（${warnings.length} 个警告）`);
    process.exitCode = 0;
  } else {
    console.error(`[完成] ${errors.length} 个步骤失败，详情见上`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[异常]", err);
  process.exitCode = 1;
});
