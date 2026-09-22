// 源 adapter 契约（M1.5 骨架；首个真实实现 github/ 在 M2 收编现 update-trending fetch 本体）。
// 目标形态：每源一个 adapter，见 docs/architecture.md §4.3 与 multisource-design §3.3。
// 跨源规则：adapter 之间不相依赖；一个源失败只记该源，不中断其它源（pipeline/run 保证）。

export interface RunContext {
  /** 编排器给本源的取消/超时信号（各源 fetch 阶段自行遵守） */
  signal?: AbortSignal;
}

export interface SourceRunResult {
  sourceId: string;
  ok: boolean;
  /** true = 本次判定未到期/无更新需做（non-due），跳过 */
  skipped?: boolean;
  message?: string;
}

export interface SourceAdapter {
  id: string;
  label: string;
  run(ctx: RunContext): Promise<SourceRunResult>;
}
