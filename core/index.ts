// core/index.ts — 组合根（composition root）。ADR A6：data 根与 env 由调用方注入，
// core 内不再 process.cwd() 隐式解析；web 传 cwd、cli 传 ROOT。
// M1 阶段为骨架占位，随各层迁移逐步充实（见 docs/architecture.md §4、§6）。
export interface CoreEnv {
  /** data/ 目录绝对路径 */
  dataDir: string;
}

export interface Core {
  dataDir: string;
}

export function createCore(opts: CoreEnv): Core {
  return { dataDir: opts.dataDir };
}
