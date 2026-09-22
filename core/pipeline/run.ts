// pipeline 编排器（M1.5 骨架）：run 单个源 / runAll（失败隔离：一源失败只记该源，不中断其它源）。
// 幂等、跨进程单飞锁由调用方（web 经 core/jobs、CLI 经同一文件锁）在上层拿；本层只负责顺序执行与汇总。
// M1.6 薄 CLI 即用本层把 github（fetch 暂仍驻 scripts/update-trending，M2 收编进 core/sources/github）跑起来。
import type { RunContext, SourceAdapter, SourceRunResult } from "../sources/adapter";

export async function runSource(
  adapters: SourceAdapter[],
  sourceId: string,
  ctx: RunContext = {},
): Promise<SourceRunResult | null> {
  const adapter = adapters.find((a) => a.id === sourceId);
  if (!adapter) return null;
  return adapter.run(ctx);
}

/** 顺序跑全部 adapter，单个异常不中断整体；返回每源结果 */
export async function runAll(adapters: SourceAdapter[], ctx: RunContext = {}): Promise<SourceRunResult[]> {
  const results: SourceRunResult[] = [];
  for (const a of adapters) {
    try {
      results.push(await a.run(ctx));
    } catch (err) {
      results.push({
        sourceId: a.id,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
