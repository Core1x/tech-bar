# core —— 依赖干净的 TS 业务引擎

> 目标形态见 `docs/architecture.md` §3/§4。M1 迁移见 `docs/execution-plan.md` §4「M 架构 Phase 1」。

**铁律：core 内零 Next import、零 `process.cwd()` 隐式**；data 根由 `createCore({ dataDir })` 注入（ADR A6）。

## 依赖表（谁可 import 谁）——由 `eslint import/no-restricted-paths` 强制执行（ADR A10，M1.7 收紧）

| 层/目录 | 职责 | 可依赖 |
|---|---|---|
| `core/domain` | 纯函数、零 I/O：SourceItem/metrics/signals-profile/topics/判读三态/日历/prompt-blocks/format | 无（或仅同层类型） |
| `core/store` | repository 接口 + FileStore（唯一碰 `data/` 的层） | `domain` |
| `core/ai` | AI provider 接口 + deepseek 实现；用量计费 | `domain`, `config`(取值), `store`(usage) |
| `core/jobs` | 跨进程单飞锁 + 状态 | `store` |
| `core/config` | 唯一读 env/密钥：ai-config/features/weekly-anchor/keySource | `domain` |
| `core/sources` | 各源 adapter（fetch/normalize→SourceItem） | `domain`, `config`, `store`, `pipeline`(run ctx 类型) |
| `core/pipeline` | 编排 run(source)/runAll + per-source schedule | `domain`, `config`, `store`, `sources`, `jobs` |
| `core/analysis` | 用例/服务：feed/watchlist/verdict/similar/digest/weekly/radar | `domain`, `sources`, `ai`, `jobs`, `store`, `config` |

**presentation（app/components）与 cli 只可依赖 `core/*` 的顶层聚合导出（services/domain），不得直连 core 的 I/O 面（store/config/ai 的实现细节）**——通过 `analysis` 服务间接用。

## 并发安全
- 写文件一律原子写；读-改-写 JSON 需模块级 `mutex` 链（模式收编自 `lib/usage.ts`/`lib/find-cache.ts`，归 store 实现内部，不散落调用方）。

## 目录现状（M1+M2 2026-09-07）
- `index.ts`：`createCore` 组合根（轻量占位，dataDir 注入待各服务接组合根后扩展）。
- `domain/`：types(+SourceItem) / signals / topics / format / calendar / summary —— 纯函数权威源。
- `store/`：file.ts（FileStore，data/ 读写）+ interface.ts（repository 契约）。
- `config/`：ai-config / features / weekly-anchor / index(+keySource) / env(CLI 加载)。
- `ai/`：provider.ts（AiProvider 接口 + deepseek 门面，实现仍驻 lib/deepseek，待收编）。
- `jobs/`：manager.ts（批任务单飞锁，泛化 JobKind）。
- `pipeline/`：run.ts（run/runAll 编排 + 失败隔离）+ schedule.ts（per-source due 判定）。
- `sources/`：adapter.ts 契约 + github/{updater,adapter}.ts（update 引擎）+ hackernews/{normalize,adapter}.ts（Phase 3 首个新源 → data/sources/hackernews/latest.json）。
- `analysis/`：summarize.ts（中文摘要，唯一实现）。digest/weekly 生成器仍在 lib（web 与 CLI 共用的唯一 TS 源）。
