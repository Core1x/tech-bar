# 目标架构（本地分层单体 · 技术信息聚合站）——设计文档

> 状态：**设计草案（2026-09-07），评审后进执行计划分阶段落地**。本文是**目标形态**的唯一权威参照。
> 相关文档：
> - `docs/execution-plan.md` = **现状与已验证**的追踪器（做完一阶段就回写它，勿在本文记完成态）；
> - （多源扩展推导曾为 `docs/multisource-design.md`，其契约与 D 系列决策已并入本文 §4.1/§4.3/§11；该文件已删）
> - 本文 §11 汇总全部 ADR（含多源 D 系列 + 新 A 系列）。
>
> 目标形态（已拍板）：**本地分层单体** —— 不拆独立后端服务/前端进程，不引常驻 DB；但在依赖边界上把"业务引擎（core）"与"呈现（web）"彻底分开，让 core 可被 web 与 CLI 共同 import。
> 本轮推进边界（已拍板）：**仅深化到文档**，不写实现。

---

## 0. 产品形态（已确认 2026-09-07）

**技术信息聚合站**：把多个高质量技术源整合到**一个网站**，主界面是**统一信息流**。

- GitHub 趋势 = **现有的一路 vertical**，保留其判读/同类/README 等"判断"能力，但不再是产品本体；
- 首批新增源 = **Hacker News**（后续 arXiv/博客 RSS/包生态按同一套 adapter 流程加）；
- 主界面口径：首页默认把各源今日条目整合成一条**统一信息流**浏览（条目带来源标签 + 各自原生度量），搜索/关注为辅；GitHub 榜单等降为板块/Tab；
- **整合 ≠ 混比**：统一外壳与时间流可以合并展示，但各源**原生度量与排序各自保留**（HN 的 points 不等于 GitHub 的 star）；跨源"今天谁值得看"用**源内归一化信号**或 **AI 综述**承担，绝不假合并度量；
- 价值增量方向：跨源 watchlist（`source:source_id`）、去重与跨源串联（同一技术同时在 HN/GitHub/arXiv 出现时聚成一条叙事）——先简单后难，列入 backlog；
- 上文的架构（分层单体、`SourceItem` 中立模型 + composite 身份、源分区、兼容垫片、消灭 `.mjs` 镜像）**正是为这个聚合站形态准备的**，方向不变；变化是"**跨源统一表面从可选升为核心**"，迁移顺序相应 feed-first（§8）。

---

## 1. 为什么是"分层单体"，而不是"完整前后端拆分"

项目复杂度上升的真实来源不是"缺一个独立后端进程"，而是这三点（拆分进程并不能解决它们，反而抬高出货/运维成本）：

| 复杂度来源 | 现状 | 拆分进程能解决吗 |
|---|---|---|
| **`.mjs` 镜像地狱** | `lib/{types,signals,jobs,weekly,digest,prompt-blocks,data}.ts` 与 `scripts/{_shared.mjs,update-trending.mjs,daily.mjs}` **双份逻辑**（类型、判读标签、单飞锁、周锚点、提示词块都要镜像）；加一规则改两处、易失步 | 否——反而多一份部署物 |
| **后台任务与请求路径混同** | 定时/长任务挂在 web 进程生命周期上（F12/F13 未做：digest 同步长请求、流不可取消）；网页"立即更新"靠 spawn 子进程 | 部分——应抽成 worker，但不必换进程语言/服务 |
| **无源与存储边界** | 身份键 `full_name`、`latest.json` 双层混装、无 adapter 契约（见上文 §4.3） | 否 |

**设计主张**：当前真正正确的形态是——**一个依赖干净的 TS core（零 Next import、可被 web 与 CLI 共同引用）+ Next 只做呈现壳（thin pages/routes）+ 后台任务统一走 core 的 job 机制（在 web 进程内触发或在独立 CLI/worker 进程触发，二者共享同一把锁）**。存储与 AI 供应商全部藏在接口后，SQLite/更多供应商/真后端将来都是**替换实现**而非重写。

**给未来的门（不现在付税）**：core 零 Next 依赖后，将来把聚合站上公开/多客户端时，拆分路径 = 同一个 core 打成 API 服务 + 调度容器，换 Sqlite/Postgres 实现，web 壳换成任何前端，网关加鉴权限流。正因为这个拆分将来便宜，**现在不必做**。

---

## 2. 约束（新代码必须遵守）

1. **形态 C（本地单机自用）**：单用户、可离线、`data/` 全 JSON/MD 文件驱动、gitignore 不入库。
2. **GitHub 现有行为与数据兼容**：榜单/详情/雷达/判读/同类/洞察/周报在迁移期间行为不变；`data/latest.json`、`data/history/` 至少可读（兼容垫片）。
3. **AI token 可控**：凡"进页面就生成"的 AI 一律 `peek=1` 探测；批任务走单飞锁 + 功能开关。此纪律不变。
4. **错误 shape `{ error: 中文 }` + 404/503/502；AI 路由 `force-dynamic; runtime="nodejs"`** —— 语义延续。
5. **数据可信溯源**：AI 只许引用快照已给数据（`_meta.fetched_at`），延续 anti-hallucination prompt 纪律。
6. **脚本零外部运行时依赖**只对"被定时器触发、无人值守运行的那个产物"成立（见 §4.9：编译产物，而非源码 `.mjs`）。
7. **聚合站校准（产品层）**：跨源只整合不混比；新源必须先有"统一条目（SourceItem）+ 能在统一信息流里渲染的卡片 + 各自原生度量"，深度判读面（profile）是可选增强。

---

## 3. 目标分层总览

```
┌────────────────────────────────────────────────────────────────────┐
│  presentation   app/ (Next 16 = 壳)                                 │
│  pages(server/client comps) · api routes(glue) · 组件              │
│  首页=统一信息流（feed service 驱动）· 源 Tab · 条目详情 · 关注      │
│  依赖：core 的 analysis/services + domain 类型。路由不写业务逻辑。   │
├────────────────────────────────────────────────────────────────────┤
│  cli  cli/*.ts 薄入口（定时/手动触发 run-source、digest、weekly…）    │
│  与 presentation 一样，只 import core，自身不含逻辑                  │
├────────────────────────────────────────────────────────────────────┤
│  core/  —— 业务引擎，零 Next import，零 process.cwd() 隐式          │
│                                                                     │
│   analysis/   用例/服务：feed(统一信息流)·watchlist·digest·weekly   │
│                ·summarize·radar + 各源深潜(verdict/similar/readme)  │
│                ← 页面与 CLI 都调这里                                    │
│        │ depends on                                                    │
│   sources/    adapter(id, profile?, fetchDiscovery, normalize)      │
│               github/（现逻辑）· hackernews/（首个新源）            │
│   ai/         provider 接口 + deepseek 实现 · 用量 · peek 缓存策略   │
│   jobs/       跨进程单飞锁 + 状态（泛化自 lib/jobs.ts）              │
│   pipeline/   编排器：run(source)/runAll · per-source 调度判定·限流· │
│               优雅停止 · 失败隔离 · 进度                            │
│   store/      repository 接口 + FileStore(现) · SqliteStore(将)     │
│   config/     configService：ai-config/features/env/密钥/来源判定   │
│   domain/     纯函数零 I/O：SourceItem/metrics/signals-profile/     │
│               topics/判读三态/日历(周·锚点)/prompt-blocks/format     │
├────────────────────────────────────────────────────────────────────┤
│   data/       唯一持久层：config/ sources/ cache/ digests/ radar/  │
│               logs/（repository 接口背后，进程无关）                │
└────────────────────────────────────────────────────────────────────┘
```

**依赖规则（单向、禁止跨层/反向）**：`presentation/cli → core/*`；`core/{analysis} → core/{sources,ai,jobs,pipeline,store,config} → core/domain`；`core/domain` 与任何 I/O/框架无关；**store 是唯一碰 `data/` 的层**；config 是唯一读 env/密钥的层。`presentation` 不得直连 `core/domain` 之下的 I/O 面。

强制手段（Phase 1 引入）：`eslint` 规则 `import/no-restricted-paths`（白名单式，把 allowed 依赖列进 eslint.config）或等价边界检查脚本，跑在 `lint` 里。文档阶段先记录规则，实现期再挂。

---

## 4. 各层要点

### 4.1 domain（纯函数，零 I/O，最该被单测的一层）
把现有 `lib/{types,signals,topics,format}.ts` 与雷达/周历的日期纯函数收进来：
- `SourceItem/SourceMetric` 中立 item（见上文 §4.1 domain）；
- `signals`：泛化出"每源一个可选的 `computeSignals(item)→Verdict|null`"的 profile 形态，**GitHub 的现有保守规则原样保留**（三态 undefined/null 语义全站统一，勿改）；profile **可选**——HN 首期可只有 metric 展示、无判读；
- 日历（自然周 mondayOf/lastSunday/锚点）、`prompt-blocks` 中立化文本块、`format`。
此层零副作用 → 单测成本最低、回归最贵，是优先测试对象（vitest，见 §10 建议）。

### 4.2 store（repository 接口；FileStore 现，SqliteStore 将来换）
```ts
// core/store/interface.ts（示意）
interface Store {
  latest(source: string): Promise<LatestSource | null>;
  writeLatest(source: string, data: LatestSource): Promise<void>;
  history(source: string, date: string): Promise<Snapshot | null>;
  listDates(source: string): Promise<string[]>;
  upsertSnapshot(source: string, date: string, repos: SnapshotRepo[]): Promise<void>;
  // config / cache（summaries·readme·verdict·similar·starIndex）/ 状态锁 各自小接口，
  // 由一个 Store 组合或分多个 store 切片，实现期定。
}
```
- **FileStore** = 泛化后的现有 `lib/data.ts`（原子写 + 模块级 mutex 语义内聚在实现内部，调用方无感），存储布局见 §7。
- **兼容垫片**：迁移期 `Store.latest("github")` 无 `data/sources/github/latest.json` 时**回读旧 `data/latest.json`**（history 同理），让现有页面零改动先跑起来，再随 Phase 推进切真分区。此为 ADR D3。
- **SqliteStore 触发门槛（ADR A4）**：当雷达/digest 对 history 的全量扫描（现 `loadRadarSeries` 每次读全部快照）或跨源检索成为真实瓶颈，且形态 C 内仍有收益时，再实现同一接口换入；否则不引。文件与 SQLite 都是 Store 实现，上层代码对此无感。

### 4.3 sources + pipeline
- `core/sources/github/`：adapter，`fetchDiscovery/normalize` **包住现 `scripts/update-trending.mjs` 逻辑**（fetch + 追踪池 + delta + 快照 + star 索引维护全部内聚进该 vertical），产出打 `source:"github"` + `_meta`。
- `core/sources/hackernews/`：**首个新源**。Algolia 公开 API（无鉴权，IP 限额宽松）：`search_by_date?tags=front_page` 取"当前热门首页故事"，`tags=story` 取最新；字段 `objectID/title/url(可外链)/points/num_comments/author/created_at` 结构化完整。normalize → SourceItem：`source_id=objectID`、`url=外链||HN 条目页`、`metrics=[points,num_comments]`、tags 空。首期**只入库+进 feed，不做判读 profile、不抓评论正文**（避免引入第二类 I/O），详情先外链 HN 原生页。
- 其余源各一目录（arXiv/博客 RSS/包生态 等，按同一契约后续加）。
- `core/pipeline/run.ts`：编排 `run(sourceId, opts)` / `runAll()` —— 幂等、单飞（跨源一把全局批锁 + 源内配额留给 adapter）、进度写入、优雅停止、**失败隔离（一源失败只记该源，不中断其它源）**、写更新状态语义泛化到每源。

### 4.4 ai（provider 接口 + 现 deepseek 实现）
```ts
// core/ai/provider.ts
interface AiProvider {
  chatStream(messages, opts:{ signal; reasoningEffort?; temperature?; maxTokens? }): AsyncIterable<string>;
  chatComplete(messages, opts): Promise<string>;
}
```
- `DeepSeekProvider` = 现有 `lib/deepseek.ts`（OpenAI 兼容，baseUrl/model 可配，SSE CRLF、reasoning_effort 降级、usage 计费全保留）。
- **接口中立只为"将来可插 Anthropic/OpenAI/Gemini/Ollama"，不是本轮要接多供应商**。provider 选择走 configService。
- `peek` 探测、指纹/TTL 缓存策略留在调用它们的 **analysis** 层（verdict/similar/review/readme 语义不变，文件落到 store 的 cache 切片），ai 层只做"调模型 + 计用量"。

### 4.5 jobs（泛化单飞锁 + 状态）
- 从 `lib/jobs.ts` 的 digest/weekly 专用，泛化为 `JobManager`：`acquire(kind,target)` / `finish` / `running` / `last`，**web 进程与 CLI 进程共用同一文件锁**。
- 新增 job kind：`source:github`、`source:hackernews`（数据更新并入同一套，替代独立 update-state 特判）+ 现有 `digest/weekly`。
- 锁语义沿用：同 kind 同 target 让位、跨 kind 有界排队、owner pid 存活 + 陈旧双条件回收。**此机制是"网页手动"与"定时 CLI"并发不打架的根基，勿改成内存锁**（有第二个进程就破功）。

### 4.6 analysis（web 与 CLI 共同调用的一层；聚合站的"读面"都在这）
现有 `app/api/{verdict,similar,review,readme,find,digest,weekly}` 里的业务逻辑、`lib/digest.ts`、`lib/weekly.ts`、`lib/radar.ts` 的"计算"都落到这里的 service；路由变 glue（取参 → 调 service → 序列化/流式透传 → 统一错误）。这是消除 `lib/digest.ts` vs `daily.mjs generateDigest` 这类双实现的位置。**新增本层聚合读服务：**
- `feed.ts` —— 统一信息流装配（契约见 §4.10）；
- `watchlist.ts` —— 跨源关注（composite id），见 §4.10。

### 4.7 config（唯一读 env/密钥的层）
- `configService` = 泛化 `lib/ai-config.ts` + `lib/features.ts` + `scripts/_shared.mjs loadEnv`：文件（`data/config/*.json`）优先、env 兜底、**lib 与脚本都只经它取值，杜绝散落 `process.env`**。
- 负责"key 来源"判定（F15 已让服务端算真值，此处集中）、开关读写、周锚点读写。
- 若将来暴露 LAN/公网（F8），鉴权加在 **web 网关层**（middleware/route guard），core 不做——core 假定调用方已授权。

### 4.8 presentation（Next 壳）
- `app/**` 页面/路由保持；业务收敛后，路由平均 < ~40 行。
- **首页改造为聚合首页**：Server Component 直读 `analysis.feed` 拼统一信息流（多源条目卡 + 来源标签 + 各自度量），GitHub 榜单等降为板块/Tab；AI 组件继续 `?peek=1` 走生成接口。
- Server Component 直读确定性数据；流式（chat/translate）由 api route 从 provider 透传 SSE。

### 4.9 cli 与构建（消灭 .mjs 镜像的关键，ADR A2）
`tsconfig` 现为 `noEmit` + bundler resolution（专为 Next/webpack），Node 不能直接跑 TS。方案：

```
scripts/ 源码（薄入口，import core）:
  cli/run-source.ts  ·  cli/daily.ts  ·  cli/rebuild-index.ts …
构建（package.json 加）:
  "build:cli": "esbuild cli/*.ts --bundle --platform=node --format=esm --outdir=dist/cli"
定时器指向:
  dist/cli/daily.mjs   ← 无人值守、无 node_modules 运行时依赖的稳定产物
dev/手动:
  npx tsx cli/daily.ts  （或直接跑 dist）
```
- **消灭对象**：`scripts/_shared.mjs`、`update-trending.mjs` 内嵌的判读/镜像、`daily.mjs` 的零依赖复刻，全部换成一个 TS 源 + 一次构建。
- 依赖：esbuild（devDependency）或 tsx 二选一（ADR A9）；**文档建议 esbuild 出可执行产物**，与"定时任务要稳、别牵 node_modules"诉求一致。实现期需加依赖并更新 `daily-task.bat` 指向 `dist/cli/daily.mjs`。

### 4.10 统一信息流（feed，产品核心读面）—— 聚合站形态的落地契约

**目标**：首页一条流，把"今天各源值得看的东西"整合展示；不追求全量塞进一屏，先保证"每个源都有卡片、来源清晰、度量不混"。

```ts
// core/analysis/feed.ts（示意）
interface FeedSection {
  id: string;
  title: string;            // 「今日热门（各源 Top）」 / 「最新入库」 / 源板块
  items: FeedItem[];
}
interface FeedItem {
  key: string;              // `${source}:${source_id}`（全局唯一）
  source: string;
  sourceId: string;         // 源内唯一 id（github=owner/name · hn=objectID），供详情页路由派生
  sourceLabel: string;
  title: string;
  url: string;
  description?: string | null;
  tags: string[];
  metric: { name: string; value: number; label: string } | null; // 该源原生度量，单值展示
  secondary?: string | null; // 额外原生度量（格式化文本：GitHub 当日增量 / HN 评论数）—— §4.10 之外的落地扩展，仍为非跨源可比项
  signals?: Verdict | null; // 可选：该源 profile 算出的 chips
  discoveredAt: string;
  watched: boolean;         // 是否在跨源 watchlist
}
```

> 已在 Phase 4 按此契约落地（`core/analysis/feed.ts`）。已实现为 `FeedItem.sourceId` 显式字段（原示意图靠 split key 推导，显式化更利于 GitHub 卡链 `/repo/{name}`）；`secondary` 为落地时的自然扩展（保留各源第二度量做卡片增强，仍不跨源比较）。
**装配规则（Phase 4 首版即可无 AI）**：
1. **各源自归一排序，再并列分块**：源 A 的 "Top" 用源 A 自身当日序列的归一化增量/热度（如 HN 按 points 当日序、GitHub 按 delta 当日序），源与源**不**互相排序混合成一个总榜；
2. 时间流块（"最新入库"）可按 discovered_at 全局排序——**时间可比，度量不可比**；
3. AI 综述块（"今日跨源值得看"）可选、走 `peek`，默认不自动，由分析层把各源已排好序的条目拼成源中立文本块喂模型；
4. feed 数据**只读已落库快照**（今日 `sources/*/latest.json`），不触发生成式 I/O、不触发拉取。

**watchlist（跨源关注）**：`data/config/watchlist.json` = `[{ source, source_id, addedAt, note? }]`，复合键去重；feed 支持"只看关注"。GitHub 现有 tracked pool 是 GitHub 源自身的 curation 语义，保留为 GitHub vertical 的池，watchlist 是跨源个人层（两者并存，先不强行合并）。

**去重/跨源串联（backlog，先简单后难）**：① 确定性：标题/外链 URL 归一化哈希，同 URL 跨源合并；② LLM 聚类：同一技术事件在多源出现时聚成"一条叙事"（重，仅当有真实痛点再做）。首期不实现，只留契约空间（`FeedItem.groupId?`）。

---

## 5. 进程模型（形态 C）

```
 机器上：
  ├─ web 进程        next dev / next start         常驻（用户在时）
  │     └ 手动触发：点「更新」「生成洞察」→ 进 core/jobs 的锁，起 core/pipeline job
  │                （可以是当前进程 await 执行，或 spawn 同一 CLI 产物；两者由锁保证不撞）
  ├─ 定时器          Windows 任务计划程序 → dist/cli/daily.mjs
  │                （一次性执行：per-source 判定"该跑没跑"→ 逐个跑 due 源 → digest/weekly due 判定）
  └─ （可选）worker 守护进程 → 真 cron + 开机补跑；形态 C 默认不开，仅记录
```

- **调度决策集中 core**：`core/pipeline/schedule.ts` 维护 per-source 判定（上次快照日期 + 目标 cadence + 现在时刻 → 是否 due），`daily.mjs` 的"跑了才算今天"逻辑泛化成它。改 cadence = 改配置，不再改脚本。GitHub 日更、HN 可一日多次/按其热度窗口，均在此配置。
- 单次定时仍可保持"一天若干次或一次"：非 due 的源近乎零成本早退。OS 调度器在形态 C 足够，**不引常驻 daemon**（ADR A5）。
- web 进程与定时 CLI 的并发安全 = jobs 文件锁（§4.5）+ store 原子写，二者都不依赖"只有一个进程在跑"的假设（现在已是如此，保持）。

---

## 6. 目标目录树（建议，含与现状映射）

```
core/
  domain/        ← lib/{types,signals,topics,format}.ts（+ 日期纯函数收编）
  store/         ← lib/data.ts 泛化；新增 interface.ts
  sources/github ← scripts/update-trending.mjs 逻辑迁移
  sources/hackernews ← 新（首个新源，§4.3）
  ai/            ← lib/deepseek.ts → provider + deepseek
  jobs/          ← lib/jobs.ts 泛化
  pipeline/      ← 编排 + schedule（新）
  analysis/      ← lib/{digest,weekly,radar,prompt-blocks}.ts + api 各业务下沉 + feed/watchlist（新）
  config/        ← lib/{ai-config,features,weekly-anchor}.ts
  index.ts       ← createCore({ dataDir, env }) 组合根
app/             ← 壳（首页改聚合 feed；其余现有结构基本不变，路由变薄）
cli/             ← 薄入口（顶替 scripts/*.mjs）
```
现有顶层 `lib/` 各文件在迁移期内按上表**机械搬迁**，用 `lib/` 作 re-export 垫片指向 core，保证既有 import 不断；搬迁完成即删垫片。

---

## 7. 数据布局（FileStore 目标形态，兼容垫片见 §4.2）

```
data/
  config/        features.json · ai-config.json · weekly-anchor.json · watchlist.json
  sources/github/latest.json · history/{date}.json · config/tracked.json
  sources/hackernews/latest.json · history/{date}.json
  sources/_registry.json            # 启用源清单
  cache/         verdicts/ similar/ reviews/ readme/ summaries.json
                 star-history.json  gen-job.lock gen-jobs.json update-state.json
  digests/  radar/  logs/
```
- **顶层 `latest.json`/`history/` 最终并入 `sources/github/`**；迁移期由 FileStore 垫片回读旧位置，页面无感。
- 跨源 feed 在 analysis 层装配（§4.10），**不入库层混装**——store 仍是源分区，保证各自 latest/history 快照纯净可比。

---

## 8. 迁移路线（分阶段，GitHub 行为不变；feed-first；每阶段结束回写 execution-plan）

### Phase 0 —— 本设计定稿
评审 §11 ADR，拍板 A9/A10；**D4 已定 = Hacker News**。

### Phase 1 —— 建 core、迁逻辑、零行为变化（纯重构，最大头的一期）
1. 搭 core 目录 + `createCore` 组合根；domain 纯函数先迁（types/signals/topics/format/日历），`lib/` 出 re-export 垫片；
2. store 抽 repository 接口 + FileStore（内部=现 data.ts），加垫片读旧位置；
3. ai provider 接口包住 deepseek；jobs 泛化；config service；
4. 挂 eslint `import/no-restricted-paths` 边界；
5. 建 `build:cli`（esbuild），把 daily/update 薄入口移到 cli/ 指向 core，**删 `_shared.mjs` 与 update-trending 的镜像**（或留一个文件做行为基准对照后删）。

验证：`npx tsc --noEmit && npm run lint`；`node dist/cli/daily.mjs` 与改动前同源输出 diff 一致；execution-plan §5 curl 回归全绿。

### Phase 2 —— GitHub 单源垂直整体走 core
fetch/normalize/追踪池/delta/快照迁进 `core/sources/github` + `pipeline/run`；数据写 `sources/github/` 真分区（垫片同时保留读旧）；schedule 判定入库；页面经 analysis service 读新 Store。

验证：跑 `run-source github` 产出分区文件正确、旧位置不再写；页面全绿；幂等重跑成立。

### Phase 3 ✅ 已落地（2026-09-08）—— Hacker News 垂直端到端（首个新源）
`core/sources/hackernews/{normalize,adapter}.ts`（Algolia front_page → SourceItem[] → `data/sources/hackernews/latest.json`）；`cli/run-source.mjs` 支持 `github|hackernews|all`，`cli/daily.ts` 每日自动拉 HN（失败仅告警）；`/hn` 页 + 侧边栏入口（标题/points/评论/外链）。不做判读 profile、不抓评论、不接 AI。

验证（2026-09-08）：`node dist/cli/run-source.mjs hackernews` 落 30 条分区快照；`/hn` live 200 渲染；GitHub 侧无回归；tsc/lint/test(16)/next build 全绿。

### Phase 4 ✅ 已落地（2026-09-08）—— 统一信息流首页（聚合站主形态落地）
`core/analysis/feed.ts`（§4.10 契约）装配各源今日快照为中立 `FeedItem[]`（源码徽标 + 各自度量 + 可选 chips + 关注态，`key=source:source_id`）；首页改聚合 feed（`FeedBoard`/`FeedCard`，GitHub + HN 板块并列），GitHub 板块可切**完整视图**（语言 Tab + 追踪池，行为无回归）；跨源 watchlist（`core/store/file.ts` 读写 + `app/api/watchlist/route.ts` + `data/config/watchlist.json`，复合键去重）＋「只看关注」过滤。先无 AI、不自动生成。

验证（2026-09-08）：`npx tsc --noEmit` / `lint` / `test`(23) / `build:cli` / `next build` 全绿；curl：首页默认出 GitHub + HN 两块（源码徽标/度量/只看关注）；点开各源条目正常（GitHub 卡→`/repo/{name}`、HN 卡→外链）；`/api/watchlist` 增删往返正确（非法入参 400）；`/hn` 与 `/repo/{name}` 200 无回归；关注增删数据落盘 `data/config/watchlist.json`；每日数据刷新后 feed 随 `latest.json`/`sources/hackernews/latest.json` 更新。GitHub 行为仍无回归。

### Phase 5 ✅ 已落地（2026-09-08）—— 深潜与跨源叙事（首版）
- **首页「今日跨源值得看」AI 综述块**：`core/analysis/cross-digest.ts` + `components/FeedSummary.tsx` + `app/api/cross-digest/route.ts`（走 peek、默认不自动、token 可控；批任务单飞锁；产物 `data/cross-digests/{date}.md`）。**整合不混比**：只喂源中立文本块（`core/domain/feed-text.ts`），让模型跨源判断，绝不假合并度量。
- **跨源 digest/周报**：**另起跨源产物**（未改动现有 GitHub `/digest`、`/radar` 语义与产物——其指标建立在 star 快照上，HN 无可比）。跨源每日综述即上面那块；跨源周报 = `lib/cross-weekly.ts`（复用 `lib/radar.computeRadar` + HN 每日快照，产物 `data/cross-digests/weekly-{endDate}.md`）。
- **去重/跨源串联（§4.10 backlog ① 确定性）**：`core/domain/canonical.ts`（URL 归一优先 + 标题兜底）+ `core/analysis/grouping.ts` → `FeedItem.groupId`（仅 ≥2 不同源成组）；卡片显示「同主题跨源 ×N · 看另一源」。LLM 聚类（backlog ②）后置未做。
- **各源详情面分派**：`core/analysis/profile.ts` 注册表（github→`/repo/{name}`，hackernews→`/hn/{id}`）；HN 本地详情页 `app/hn/[id]/page.tsx`（读本地 latest，无则 404；不抓评论正文——沿用 Phase 3「避免第二类 I/O」纪律）。

验证（2026-09-08）：`tsc`/`lint`/`test`(38)/`build:cli`/`next build` 全绿；curl：综述块 + 两源板块、`/api/cross-digest` peek/POST（未命中 available:false→生成→二次 cached:true）、`/hn/{id}` 200/404、`/hn`/`/repo`/`/digest`/`/radar`/`/api/watchlist` 200 无回归。

> 未做（留待按价值排队）：跨源 LLM 聚类、把现有 digest/weekly/radar 生成器物理迁 core（M 遗留收尾）、HN 评论区聚合（新增第二类 I/O；HN 现默认关闭——源可插拔）。

### 换国内信息源 + 源可插拔（2026-09-08，已验证）
用户确认 HN 为外网、需梯子、对本地自用不合理 → **以国内可直连源替换**：新增掘金 `core/sources/juejin` + 博客园 `core/sources/cnblogs`（实测免梯子直连，落 `sources/{juejin,cnblogs}/latest.json`）；并把「源集合」从 `buildFeed`/`run-source`/`daily` 的**硬编码改为枚举启用源**——`core/config/sources.ts` 读 `data/config/active-sources.json`（默认 `github+juejin+cnblogs`，**不含 HN**）+ `core/sources/registry.ts` 登记全部可用源。`buildFeed` 按启用源逐源装配板块；首页源 Tab / 侧边栏导航由启用源**动态生成**（HN 默认不出现）。**Hacker News 代码保留、默认禁用**（往 active-sources.json 加 "hackernews" 即可启用）。
> 这同时还掉了此前「adapter 契约只有 run()、加源要改多处硬编码」的架构欠账——现在加/删一个源 = 加 adapter + registry 登记 + 控启用源配置。

**每源接入增量成本（原 multisource-design §5，已并入）**：拉取、规范化各一个函数；入库与 AI 叙事走通用（复用快照写/peek/锁/中立块）；判读加一个 `SourceProfile.computeSignals`；呈现加一张页。即最小垂直 ≈ **2 个函数 + 1 个 profile + 1 张页面**，不触碰共享管道。

---

## 9. 错误 / 日志 / 可观测性（沿用并服务化）
- core 抛 `AppError(status, zh)`（404/503/502 语义现成），presentation 统一序列化为 `{ error }`。
- 日志：`data/logs/`（web 更新、daily 现两份）收敛为 core 的 `logger`，写入 + console 双端，source/job 带 tag。
- 用量（ai-usage）计费留在 ai provider 层（现 `lib/usage.ts` 语义），继续只计真实 AI 调用。

---

## 10. 测试策略建议（实现期引入，非本轮）
- domain 层（signals/日历/parse 白名单解析/prompt 块/feed 装配纯逻辑）零 I/O → **vitest 单测**，这是当前唯一未覆盖却最贵回归的一层；
- 迁移 Phase 关键点用手动 diff + 上述 curl 回归即可，先不引入端到端框架。

---

## 11. 决策记录（ADR 汇总）

**已定**

| ID | 决策 | 结论 |
|---|---|---|
| A13 | 产品形态 | **技术信息聚合站**；主界面=统一信息流；GitHub=现有 vertical；整合不混比（§0） |
| D4 | 首个新源 | **Hacker News**（Algolia 公开 API；§4.3） |
| D1 | 统一层级 | 管道/抽象级，非字段级（每源原生度量保留） |
| D2 | 跨源榜/流 | 统一外壳与时间流可并（时间可比）；各源度量与排序保留，跨源"值得看"用源内归一化或 AI 综述，**不假合并度量**（§4.10） |
| D3 | 存储迁移 | 先兼容垫片后切 `sources/github/` 分区 |
| A1 | 目标形态 | 本地分层单体，非真前后端；core 零 Next import |
| A2 | .mjs 镜像 | ✅ 已消灭（M2 2026-09-07）：update 引擎迁 `core/sources/github`、摘要迁 `core/analysis`；`scripts/{_shared,update-trending,daily}.mjs` 删除；web 更新与定时器走 `dist/cli/{run-source,daily}.mjs`（esbuild 产物） |
| A3 | web=壳 | 业务下沉 analysis，路由只 glue；首页改 feed service 驱动 |
| A4 | 存储 | Store 接口 + FileStore 现；SQLite 仅在扫描/跨源瓶颈时换（门槛记录） |
| A5 | 调度 | 决策集中 core/schedule；OS 定时器跑 one-shot due；不引常驻 daemon |
| A6 | data 根 | 由 `createCore({ dataDir })` 注入，不靠 `process.cwd()` 隐式（web 传 cwd、cli 传 ROOT） |
| A7 | AI 供应商 | provider 接口中立，当前 deepseek 实现；不加新供应商非本轮目标 |
| A8 | 密钥/环境 | 仅 configService 读写 env/密钥，lib 与脚本都经它取值 |
| A9 | cli 构建 | **esbuild** 出 `dist/cli/*.mjs`（2026-09-07 拍板） |
| A10 | 依赖边界强制 | **eslint `import/no-restricted-paths` 白名单**（2026-09-07 拍板；M1.1 已挂守卫，完整 zones 收紧并入 Phase 2） |

**沿用 ADR 表的 D5–D7**（D5 锁范围/频率待实现期细化；D6 数据库维持文件；D7 形态 C 默认不变）。

**待定 / 需要评审拍板**
| ID | 项 | 备注 |
|---|---|---|
| A11 | Phase 1 任务拆解 | ✅ 已拆入 `docs/execution-plan.md` §4「M 架构 Phase 1」；M1.0–M1.5 落地；M1.6 随 M2 完成（薄 CLI + 删镜像）；M1.7 部分完成（guard 已挂、收尾已做，完整 zones 待 generators/deepseek 全入 core 后收紧） |
| A12 | 安全（F8/F9） | 保持本地 127.0.0.1 即可不动；若暴露 LAN/公网，鉴权限流加 web 网关层（core 假定已授权） |
| D5 | 源调度 cadence 细表 | GitHub 日更、HN 一日多/热度窗口；实现期在 schedule.ts 定参数 |

---

## 12. 与现有文档的分工（防文档熵）
- `architecture.md`（本文）：**目标架构唯一参照**，只描述"该长成什么样 + 决策依据"，不记完成态。
- `execution-plan.md`：**现状追踪器**——每完成一阶段，把"已完成/验证/新增文件"记进去，并在此文 ADR 上把对应项标 done。execution-plan §1 战略定位仍以「GitHub 判断」为主线叙事，与本文 A13「聚合站」口径**不一致处待 owner 示意后回写**（§1 是产品叙事，不在本轮擅自改）。
- （多源推导 `multisource-design.md` 已删）：其契约与增量成本并入本文 §4.1/§4.3/§8；D 系列决策并入 §11。
- 文档是否彼此串指针，评审后建议：`CLAUDE.md` 首行加一句「目标架构见 docs/architecture.md」，避免后续会话只读 execution-plan 而不知目标形态。
