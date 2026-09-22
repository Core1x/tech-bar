// cli/hot.ts — GitHub 热榜运维入口。用法：
//   node dist/cli/hot.mjs                 重建榜单快照（=rebuild，纯 searchRepos、零 AI）
//   node dist/cli/hot.mjs rebuild         同上
//   node dist/cli/hot.mjs probe           对当前类目查询式做「实跑体检」→ 控制台 + 落报告（不改数据）
//   node dist/cli/hot.mjs summarize       为快照内缺中文摘要的仓库增量补全（需 key；单次有上限，可重复跑）
// 退出码：0 成功 / 1 失败 / 2 限流部分完成（与 run-source 口径一致）。
import { loadCliEnv } from "../core/config/env";
import { rebuildHotSnapshot } from "../core/sources/github/hot";
import { runHotProbe } from "../core/analysis/hot-probe";
import { runSummarizeHot } from "../core/analysis/summarize";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function main() {
  loadCliEnv();
  const arg = process.argv[2] ?? "rebuild";

  if (arg === "probe") {
    const { code, reportPath, message } = await runHotProbe();
    console.log(`[体检] ${message}${reportPath ? `（报告：${reportPath}）` : ""}`);
    process.exitCode = code;
    return;
  }

  if (arg === "summarize") {
    const r = await runSummarizeHot();
    console.log(`[摘要] ${r.message}`);
    process.exitCode = r.skipped ? 0 : 0;
    return;
  }

  // 默认 rebuild
  const r = await rebuildHotSnapshot();
  console.log(`[热榜] ${r.message}`);
  process.exitCode = r.code;
}

main().catch((err) => {
  console.error("[异常]", errMsg(err));
  process.exitCode = 1;
});
