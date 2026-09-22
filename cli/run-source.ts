// cli/run-source.ts — 手动/定时「跑源」薄入口。用法：node dist/cli/run-source.mjs [github|all|juejin|cnblogs|hackernews|…]
// 默认（无参）= 跑全部「启用源」（core/config/sources 读 active-sources.json，默认 github+juejin+cnblogs）。
// github 走 runUpdateTrending 保留退出码 0/1/2（web「立即更新」依赖）；非 github 源走各自 adapter（一源失败不拖死其它）。
import { loadCliEnv } from "../core/config/env";
import { runUpdateTrending } from "../core/sources/github/updater";
import { readActiveSources } from "../core/config/sources";
import { sourceById } from "../core/sources/registry";
import type { SourceRunResult } from "../core/sources/adapter";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 跑单个非 github 源 */
async function runOne(sourceId: string): Promise<SourceRunResult> {
  const adapter = sourceById(sourceId)?.adapter;
  if (!adapter) return { sourceId, ok: false, message: `未知源「${sourceId}」` };
  try {
    return await adapter.run({});
  } catch (err) {
    return { sourceId, ok: false, message: errMsg(err) };
  }
}

async function main() {
  loadCliEnv();
  const arg = process.argv[2] ?? "all";

  // 显式只跑 github：保退出码（web「立即更新」spawn 本产物、依赖 0/1/2 语义）
  if (arg === "github") {
    process.exitCode = await runUpdateTrending();
    return;
  }

  // 显式指定单源（juejin/cnblogs/hackernews）
  if (arg !== "all") {
    const r = await runOne(arg);
    console.log(`[${r.sourceId}] ${r.ok ? "成功" : "失败"}：${r.message ?? ""}`);
    process.exitCode = r.ok ? 0 : 1;
    return;
  }

  // 默认 all：**所有启用源并发跑**（github 走 update 引擎保退出码；其它走各自 adapter）。
  // 各源写各自的 latest 文件互不相干；辅助源不再排在 github 几分钟详情拉取之后，整体墙钟取最长源。
  // 退出码聚合（/api/update 依赖）：任一源失败 → 1；无失败但有源限流部分成功 → 2；全成功 → 0
  const active = await readActiveSources();
  let partial = false;
  const results = await Promise.all(
    active.map(async (id): Promise<SourceRunResult> => {
      if (id === "github") {
        const code = await runUpdateTrending();
        if (code === 2) partial = true;
        return {
          sourceId: "github",
          ok: code === 0 || code === 2,
          message: code === 0 ? "更新完成" : code === 2 ? "配额不足，已保存部分（退出码 2）" : `更新失败（退出码 ${code}）`,
        };
      }
      return runOne(id);
    }),
  );
  for (const r of results) console.log(`[${r.sourceId}] ${r.ok ? "成功" : "失败"}：${r.message ?? ""}`);
  process.exitCode = results.some((r) => !r.ok) ? 1 : partial ? 2 : 0;
}

main().catch((err) => {
  console.error("[异常]", err);
  process.exitCode = 1;
});
