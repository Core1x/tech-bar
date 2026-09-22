// GitHub 源 adapter：把 runUpdateTrending（fetch/池/delta/快照）包成 SourceAdapter，
// 供 core/pipeline/run 编排与 cli/run-source 调用（架构 §4.3 / adapter 契约）。
import type { SourceAdapter, SourceRunResult } from "../adapter";
import { runUpdateTrending } from "./updater";

/** 退出码 → 结果语义：0 成功 / 1 失败 / 2 限流提前停止（已保存部分，ok 视为已跑） */
function toResult(code: number): SourceRunResult {
  if (code === 0) return { sourceId: "github", ok: true, message: "更新完成" };
  if (code === 2) return { sourceId: "github", ok: true, message: "配额不足，已保存部分数据（退出码 2）" };
  return { sourceId: "github", ok: false, message: "更新失败（退出码 1）" };
}

export const githubAdapter: SourceAdapter = {
  id: "github",
  label: "GitHub 仓库趋势",
  run: async () => toResult(await runUpdateTrending()),
};
