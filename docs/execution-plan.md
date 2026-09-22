# 项目执行文档（优化计划 · 战略 · 待办）

> 用途：**后续会话先读本文件再动手**。记录战略定位、已完成状态（切片1/2，均已验证）、可复用基建与设计约定、待办路线图、以及一个全新 agent 续作时的验证步骤。
> 2026-09-22 开源前历史重置：本地 `master` 改为单条「init 干净起点」提交（daily-task.bat/.vscode/.claude/机器路径/运行数据均不入库；`.gitignore` 已补）。**完整开发历史（含 M0–M5 里程碑提交）保留在本地分支 `history-backup`，勿删**。推送需 `git push -f` 覆盖旧远程，或新建空仓库首推。⚠️ 环境陷阱：本机 `git switch --orphan` 会把已跟踪文件从磁盘删光（与 `git checkout --orphan` 不同），建干净历史须紧接着 `git checkout <旧分支> -- .` 恢复，或改用 `git checkout --orphan`。
> 站名更名（同日，见下）
> 最后更新：2026-09-22（**站名更名「极客信息聚合站」→「技术信息聚合站」**：界面文案/metadata/AI prompt/README/CLAUDE.md/architecture.md 同步；历史条目、package name 与目录名不改。同时隐藏 dev 编译指示器 `next.config.ts` `devIndicators:false`（左下角转圈图标，仅 dev 存在、不进生产包）。前次 2026-09-18（**产品优化轮 M0–M5 全部落地并逐项验证完毕**：按 `docs/product-optimization-plan.md` 逐里程碑执行（M0 基线 / M1 简报 / M2 关注中心 / M3 决策与对比 / M4 趋势行动化 / M5 寻找·数据源·偏好 + 导航 IA），各节见 §2，总验收见 §2 末；107 测全绿、四视口全页面零溢出、新鲜度/无 Key 矩阵实测通过；提交由项目负责人择机执行）。
> 2026-09-07（在切片1/2 基础上新增「功能设置·自动生成开关」与「批任务单飞锁」，设置/详情页/洞察/雷达均已同步；提交由项目负责人择机执行）。
> 2026-09-11 落地 **GitHub 热榜存量榜（/hot）**（10 类目查询式实拉、运行期零 AI、技术性过滤+理由可见、重建/摘要 CLI 与 daily 接线）；**按用户指示不做政治敏感/关键词审查**（详见 §2 该增量与 §3 约定）。同批完成「技术热点追踪」改名。
> 2026-09-14/15 体验两轮：刷新/重建按钮统一 `useBackgroundTask`（切页回来恢复进度，见 §3）；更新链路**快路径两段写 + 各源并发 + 源侧重试**（实测全链 ~31s、榜单 ~17s 可见）；**详情页 AI 判读/评测/同类默认收起为一行状态条**（auto=展开时才生成），判读/评测/同类 AI 调用统一关思考提速（详见 §2）。
> 2026-09-11 双修复落地：**GitHub 趋势榜对齐 Explore**（抓 github.com/trending 页 → latest.trending，feed/完整视图/入池/digest 输入全部换口径；新星榜保留）+ **「今日跨源值得看」提速**（关思考网关参数 + POST 全后台化 + 文章缩短，12ms 应答/约 1 分钟内出稿；顺带修锁的 kind 归因与僵尸锁心跳回收，见「趋势榜与综述提速」小节）。
> 同日战略口径更新：§1 定位为**极客信息聚合站**（统一信息流为主，GitHub=现有 vertical，首新源 Hacker News）；目标架构见 `docs/architecture.md`（§4.3 sources / §11 ADR 含多源契约）；多源推导文档已并入其上。
> 同日 M2 迁移落地：数据更新引擎迁 `core/sources/github`、摘要生成迁 `core/analysis`，`scripts/{_shared,update-trending,daily}.mjs` 删除，web「立即更新」与定时器改走 `npm run build:cli` 产物 `dist/cli/{run-source,daily}.mjs`。本文 §2/§3 历史段落引用旧脚本处均为**迁移前实现描述**。
> 次日（2026-09-08）Phase 3 落地：新增 Hacker News 源（`core/sources/hackernews` + `data/sources/hackernews/latest.json` + `/hn` 页），`run-source`/`daily` 支持多源。
> 同日（2026-09-08）Phase 4 落地：**统一信息流首页**（聚合站主形态）——`core/analysis/feed.ts` 装配各源今日快照为中立 FeedItem（各源并列分块、度量不混比、源码徽标+各自度量+可选 chips+关注按钮）；首页改聚合 feed（`FeedBoard`/`FeedCard`），GitHub 板块可切完整视图（语言 Tab+追踪池，行为无回归）；跨源关注 `core/store/file.ts` watchlist + `app/api/watchlist/route.ts` + `data/config/watchlist.json`（复合键去重）+「只看关注」过滤；零 AI / 零拉取（控 token）。
> 同日（2026-09-08）Phase 5 落地：**深潜与跨源叙事**——① 首页「今日跨源值得看」AI 综述块（`core/analysis/cross-digest.ts` + `components/FeedSummary.tsx` + `app/api/cross-digest/route.ts`，走 peek、token 可控、批任务单飞锁）；② 跨源去重/串联（`core/domain/canonical.ts` + `core/analysis/grouping.ts` → `FeedItem.groupId`，确定性 URL/标题归一，≥2 不同源成组）；③ 跨源周报（`lib/cross-weekly.ts`，复用 `lib/radar.ts computeRadar` + HN history，独立产物 `data/cross-digests/weekly-{endDate}.md`）；④ HN 详情面分派（`core/analysis/profile.ts` + `app/hn/[id]/page.tsx` 本地详情页，不抓评论正文）。
> 同日（2026-09-08）**源插拔化 + 换国内信息源**（用户确认 HN 为外网、需梯子、不合理 → 移除依赖）：新增掘金 `core/sources/juejin` + 博客园 `core/sources/cnblogs` 两个 adapter（实测国内直连免梯子）；源接入改为**枚举启用源**（`core/config/sources.ts` 读 `data/config/active-sources.json`，默认 `github+juejin+cnblogs`，**不含 HN**）+ `core/sources/registry.ts` 登记；`buildFeed`/`cli/run-source`/`cli/daily` 改为按启用源遍历；侧边栏与首页 Tab 动态按启用源渲染（HN 默认不出现）。**HN 代码保留但默认禁用**（将来要开，往 active-sources.json 加 "hackernews"）。同时 **web「立即更新」(`/api/update`) 已从只刷 github 改为刷全部启用源**（spawn `run-source.mjs all`），退出码 0/1/2 聚合保留"限流部分成功"提示。

---

## 1. 战略定位（为什么做这些）

项目基础是 GitHub 趋势 + AI 工具的本地自用站（Next.js 16.3.1，数据驱动：`data/` 下 JSON/MD 全量驱动内容，零额外后端；现阶段内容为 GitHub 一路）。
**产品形态（2026-09-07 确认，目标架构见 `docs/architecture.md` §0/A13）**：**极客信息聚合站**——把多个高质量技术源整合到**一个网站**，主界面是**统一信息流**。GitHub 趋势是**现有的一路 vertical**（保留其判读/同类/README 等"判断"能力），不再是产品本体；首批新增源定为 **Hacker News**（ADR D4），后续 arXiv/博客 RSS/包生态按同一 adapter 契约加。

**战略定位**：各平台擅长给"流"（榜单/时间线/搜索/托管），但**不给判断与筛选**——流里什么真的值得你看、它和同类怎么比、是不是虚火/昙花一现。聚合站的价值 = **把多源高质量信息汇到一站（统一入口、去重串联、各源度量不混比）+ 给跨源筛选与判断**：

> 平台给你信息流，我给你**筛选与判断**——值不值得看、是活是死还是虚火、同类还有谁、适不适合你。
> GitHub 那句旧愿景（"GitHub 给你仓库，我给你判断"）仍在，但降格为 GitHub 这一路 vertical 的价值主张；"判断"能力随切片1/2/雷达的产出泛化为**每源一个 signal profile + 跨源 AI 综述**（architecture.md §4.1/§4.10/§8 feed-first）。

约束与留门（不变）：**先深耕本地自用**（形态 C）；确定性判读全部做成"即时公开信号、不依赖历史积累"，为将来做成开箱即用公开站（中心化预热攒历史）留门；**整合不混比**——统一外壳/时间流可比，各源原生度量与排序各自保留。

---

## 2. 已完成（已验证，勿重做）

### 切片1「项目判读」（榜单/详情/寻找结果显示"是活是死、有没有坑"）

两层：**确定性信号层（零 AI）** + **详情页懒生成 AI 判读句**。判定风格=**保守只标硬旗**。

新增文件：
- `lib/signals.ts` — 纯函数引擎，零 I/O 零 hooks，服务端/客户端通用。导出 `computeSignals(repo, now?)→{level, chips:[{kind,tone,label,detail}], lastPushDays}`、`lastPushAgeDays`、类型 `VerdictSource/ChipTone/ChipKind/Verdict`。
  规则（保守）：红=已归档 / 距上次 push>365 天；黄=180–365 天更新放缓 / 无开源许可证；绿=距上次 push≤30 天活跃维护；31–179 天不标；任何信号缺失→空 Verdict。已归档时跳过维护期判定（避免红叠红）。`license:null`/`''`→黄（确无许可）；`undefined`→未知不标（三态语义，全站统一）。
- `components/VerdictChips.tsx` — chips 渲染器，`{repo, className?, hideKinds?}`，空→null。tone 色：红 `#f85149`/黄 `#d29922`/绿 `#3fb950`（`/40 border /10 bg`）。`title={detail}` 溯源。
- `app/api/verdict/route.ts` — AI 判读句：懒生成、**原子写**、**按身份信号指纹缓存**（`data/cache/verdicts/{owner}__{name}__{12hex}.md`，sha1 排除了 stars/delta/topics → 只随身份/长寿命信号变而刷新，规避 review 缓存"永不失效"缺陷）。prompt 强制"只许引用已给信号、禁编造"。镜像 `/api/review` 的错误/降级语义（404/503/502）。
- `components/AiInsight.tsx` — AI 判读/评测卡共用实现（导出 AiVerdict/AiReview，骨架/红错/就绪/auto 同一份）。

管线改动：
- `scripts/update-trending.mjs` 三处白名单补字段（`pickRepoFields`、新星内联 mapper、**追踪池 mapper**）→ `latest.json` 每仓带 `pushed_at`(日期串)、`archived`(bool)、`license`(SPDX|null)。零额外 API（字段本在响应里）。**勿改** history 快照 writer 与 star-history 索引。
- `lib/types.ts`：`NewStarRepo/TrackedRepo` 加 `pushed_at?/archived?/license?`；`GhRepo` 加 `pushed_at?/archived?`。
- find 链路：`components/FindStore.tsx`(FindRepo)、`lib/find-cache.ts`(CachedFindRepo)、`app/api/find/route.ts`(outRepos) 补 `pushed_at/archived`（license 已有）。

挂载面（chips）：`components/RepoRow.tsx`（新星榜，**hideKinds=["active"]**——新星榜仓库按构造≤30 天，绿"活跃"必全=噪音）；`components/TrackedTrend.tsx`（追踪池，**行标记为 RepoRow 的内联复制品，必须单独改**）；`components/ProjectFinder.tsx`（find 结果，hideKinds=["no-license"]，行头已有许可证 pill）；详情页信息卡（desc 与 topics 之间，服务端直出）。
**详情页布局（已重排，2026-09-03）**：单列流——信息卡（全宽，含判读 chips）→ Star 趋势卡 → 「AI 解读」两卡**并排双栏**（`<AiVerdict key={verdict-${fullName}}/>` + `<AiReview key={review-${fullName}}/>`，半宽各 552px）→ 同类项目 → README。不再有 300px 窄侧栏堆两张懒加载长卡；**AiVerdict 与 AiReview 是兄弟组件，key 必须加不同后缀**（曾共用 `key={fullName}` 触发 React duplicate-key 警告）。

### 切片2「同类项目」（详情页显示"同类还有谁、怎么选"）

形态：详情页全宽 section（主网格与 README 之间）。候选=本地今日池 topic 重叠 + GitHub 精选 topic 现拉。取舍=信号 chips + AI 一句中文取舍。

新增文件：
- `app/api/similar/route.ts` — 候选收集 → AI 取舍 → 双 TTL 缓存。要点：
  - `findRepoInfo` 同 verdict（live 分支补 html_url）；`fingerprint`=identity **含 topics+language**（话题即查询输入），排除 stars/delta。
  - `GENERIC_TOPICS` 停用词表（纯语言 + 包络词 library/framework/tool/api/cli/bot/plugin/awesome/web/ui…；供应商/生态话题 `dsh`/`dsh-plugin`/`claude`/`deepseek` 保留为具体）。`specificTopics/topicOverlap/pickSearchTopics/deriveKeyword/searchOnce`。
  - 本地候选需共享 **≥1 具体话题**；取 MAX_SEND=8；本地不足 8 才做 GitHub 搜索（≤2 次 × per_page 8，topic:xxx 或 description 关键词兜底）；403/429/网络→`searchDegraded` 用本地继续。**无 AI key 绝不搜索**（外层保证）。
  - AI：`buildTradeoffPrompt`（列出当前仓库+每候选 1..N 行仅已给信号；指令挑≤4 真同类、同生态周边斟酌、宁少勿凑、禁编造）；`parseTradeoff` **纯文本白名单解析**（只认 `^owner/repo 分隔符+ 文本$`，分隔符吞连续破折号串 `[——:：\-–]+`，杜绝残留前导"—"）；绝不 JSON.parse 模型输出。
  - 缓存 `data/cache/similar/{owner}__{name}__{指纹}.json`：`source:"ai"` TTL 7 天；`source:"no-ai"`（AI 失败/空后 fallbackPick 确定性兜底）TTL 6h；**无 key 永不写缓存**。
- `components/SimilarProjects.tsx` — 客户端区块（骨架/红错/就绪）；每行=名称链 + LangDot/★/DeltaBadge(本地)/"今日池"标签/外链 + **VerdictChips（不隐藏任何 kind）** + "取舍"小标签+AI 句（无 AI 显示"未生成 AI 取舍"）；空态淡一行；note 提示。

修改：`lib/types.ts` 加 `SimilarItem/SimilarResponse`；详情页信息卡与 README 之间插 `<SimilarProjects key={fullName} repo={fullName}/>`；README 功能说明与数据表加条目。

### 「功能设置」增量：设置页双板块 + 自动生成开关（2026-09-04，已验证类型/规范）

形态：设置页拆成「AI 接入设置」与「功能设置」两块卡片；新增本地功能开关 `data/config/features.json`，拨动即存（写入 `lib/features.ts`，读-改-写有模块级串行链）。

- `lib/features.ts` — 五个开关：`autoDailyInsight`/`autoWeeklyReport`（默认 **true**，定时任务自动生成日报/周报，沿用既有行为）+ `autoVerdict`/`autoReview`/`autoSimilar`（默认 **false**，详情页「打开即自动生成」，沿用既有 peek 点按行为）。默认值口径与 `scripts/_shared.mjs readFeatureFlags()` 同步（脚本零依赖须镜像）。
- `/api/config` GET/POST 增 `features`（值须为布尔，仅写给定键）。设置页开关即时保存、乐观更新失败回滚；GitHub Token 仍走 ai-config.json 但 UI 归到「功能设置」卡。
- `scripts/daily.mjs`：步骤 3（日报）/步骤 4（周报）除 key 门控外加开关（`autoDailyInsight`/`autoWeeklyReport` 为 false 时跳过并提示可手动）。手动生成按钮（/digest、/radar）不受开关影响。
- 详情页三 AI 组件 `AiVerdict/AiReview/SimilarProjects` 加 `auto` prop（默认 false）：auto 时挂载直走生成接口、未命中缓存即自动生成（`autoStartedRef` 防 StrictMode 双跑）；repo 页 `readFeatures() && hasDeepSeekKey()` 决定传 auto 与否（无 key 回落点按）。

已知取舍：开启详情页自动生成后，访问无缓存的仓库页会立即消耗 token（判读/评测/同类共 ≤3 次）；默认关闭，符合「token 可控」约定。若想更进一步做**每日批量为追踪池预生成**缓存，属另一形态（更耗 token 且需脚本复刻生成逻辑），未做。

### 「批任务单飞锁」增量（2026-09-04，已验证类型/规范/行为）

目的：**AI 周报/洞察生成不被其它流程打断、不重复生成**。网页手动与 `daily.mjs` 定时是两条独立进程，此前几乎同时触发会双份 token、后写覆盖前写。

- `lib/jobs.ts`（Next 进程用）+ `scripts/_shared.mjs` 镜像（daily 用）：跨进程文件锁 `data/cache/gen-job.lock`（O_EXCL 原子创建 + pid 存活/超时陈旧回收）+ 状态 `data/cache/gen-jobs.json`。`acquireJob`：digest/weekly **共用一把锁**（互斥不并行）；同 kind 同 target 在跑 → 返回 null（让位，等对方产出）；不同 kind → 有界排队等待。`finishJob` 先落 `running:null`（仍持锁）再放锁，避免等待者已抢锁却被误清 running。
- 数据更新中（`update-state.json` 有存活 pid）生成请求 → 409（`lib/jobs.isUpdateRunning`）。
- `/api/digest`、`/api/weekly`：更新中 409；拿锁失败（同任务已在跑）→ 200 `{ok,running:true}`；拿锁成功才真正生成。新增 `GET /api/gen-status` 供轮询。
- `daily.mjs` 步骤3/4 生成前 `acquireJob`，被占用则跳过（完成后自动可见）。
- 前端：`components/JobRunningNotice.tsx` 轮询状态、任务结束自动刷新；digest/radar 页在对应任务进行中渲染该提示替代生成按钮；Digest/Weekly 生成按钮收到 `running:true` 也转提示等自动刷新。详情页自动判读/评测/同类在批任务进行中回落到点按（`repo` 页读 `runningJob()` 关 auto）。
- 残留崩溃锁由 pid 存活 + 20 分钟陈旧双条件回收，不阻塞下次生成。

### 「统一信息流首页」增量（Phase 4，2026-09-08，已验证 类型/规范/测试/构建/curl）

形态：首页 = **极客信息聚合站** —— 默认多源并列分块（GitHub 今日热门 + Hacker News 今日热门），每条为中立 `FeedItem` 卡片（源码徽标 + 各源原生度量 ★/pts + 描述 + tags + 判读 chips + 关注按钮）；各源**独立排序、度量绝不跨源混比**；GitHub 板块可切**完整视图**（语言 Tab + 追踪池趋势，行为无回归）。

新增文件：
- `core/analysis/feed.ts` — `buildFeed(opts?)` 装配统一信息流：**只读各源今日已落库快照**（GitHub 顶层 `latest.json`（D3 垫片）、HN `sources/hackernews/latest.json`），零生成式 I/O、零拉取。导出纯映射 `githubRepoToFeedItem`/`hnItemToFeedItem`（剔除 GitHub 新星榜逻辑噪音「active」chip，与 RepoRow 一致）+ `sourceLabel`/`feedItemKey`/`watchedKeySet`。返回 `FeedSectionResult[]`（`id/title/sourceLabel/items/fetchedAt/count`）。
- `app/api/watchlist/route.ts` — GET 全量关注（`{items,keys}`）；POST `{source,source_id}` 切换关注（`ok/added/watched/items`）；校验入参（错误 shape `{error:中文}`）。
- `components/FeedCard.tsx` — 中性卡片渲染（无 hooks，服务端/客户端通用）；GitHub 标题链内部详情页（保留判读/同类/README），HN 标题外链；源码徽标配色 GitHub 蓝/HN 橙。
- `components/FeedBoard.tsx` — 客户端看板：源 Tab（聚合/GitHub/HN）+「只看关注」过滤 + 关注切换（乐观更新、失败回滚、错误提示）+ 每板块展开；GitHub Tab 渲染完整原视图（TrendingTabs + TrackedTrend）。

修改：`core/domain/types.ts`（`FeedItem` 含 `key/source/sourceId/sourceLabel/title/url/description/tags/metric/secondary/signals/discoveredAt/watched`、`FeedSectionResult`、`WatchlistEntry`）、`core/store/file.ts`（`WATCHLIST_FILE` + `readWatchlist/writeWatchlist/toggleWatchlist/watchlistKey`，读-改-写模块级串行锁 + atomicWrite）、`app/page.tsx`（改读 `buildFeed` + `readLatest`，渲染 `FeedBoard`）、`components/Sidebar.tsx`（品牌「信息聚合站」，首页导航更名「聚合信息流」，后于 2026-09 再更名「技术热点追踪」）、`app/layout.tsx`（metadata 更名「极客信息聚合站」）。

验证：`npx tsc --noEmit` / `npm run lint` / `npm run test`(23) / `npm run build:cli` / `npm run build` 全绿；curl：首页出 GitHub+HN 两板块（含源码徽标/度量/只看关注）、`/api/watchlist` 增删往返正确（非法入参 400）、`/hn` 与 `/repo/{name}` 200 无回归。

### 「深潜与跨源叙事（Phase 5）」增量（2026-09-08，已验证 类型/规范/测试/构建/curl）

形态：Phase 5 四块一次落地 —— ① 首页「今日跨源值得看」AI 综述块（跨源判断，peek 默认不自动）；② 跨源去重/串联（确定性归一 → `FeedItem.groupId`）；③ 跨源周报（重复用 GitHub radar + HN 每日快照）；④ HN 详情面分派（本地详情页）。

新增文件：
- `core/domain/feed-text.ts` — 源中立文本块：把 `FeedItem[]` 排成「[源标签] title｜metric.label｜secondary｜tags｜desc」逐行文本（供跨源综述拼 prompt；**整合不混比**只给源内已排序条目+各源原生度量）。
- `core/domain/canonical.ts` — 去重归一纯函数：`canonicalUrlKey`（host/path、去 www/query/hash/尾斜杠，`github.com/o/r` → `o/r`）+ `canonicalTitle`（小写/折叠空白/剥尾部 `[..]/(..)`）+ `canonicalSubjectKey`（URL 优先，HN 自身 item 页走标题兜底；无信息 → null）。
- `core/analysis/grouping.ts` — `groupFeedItems`/`applyGrouping`：按 canonical subject 聚簇，**仅当 ≥2 个不同源**才成组（单源 full_name/objectID 本唯一，避免同名误并）；`buildFeed` 末尾接入写 `groupId`。
- `core/analysis/cross-digest.ts` — `generateCrossDigest(date)`：`buildFeed()` → feed-text 中立块 → `createDeepSeekProvider().completeChat` → `atomicWrite data/cross-digests/{date}.md`。幂等、无 key 503、无数据 400。
- `lib/cross-weekly.ts` — `generateCrossWeekly(endDate)`：复用 `lib/radar.ts computeRadar`（不改），HN 深度读 `sources/hackernews/history/*.json`（本周期按 points 去重取 Top），拼跨源 prompt → 产物 `data/cross-digests/weekly-{endDate}.md`（前缀避开 listCrossDigests 日期正则）。HN 未满一周时 prompt 注明、不失败。
- `core/analysis/profile.ts` — 各源详情入口注册表 `SOURCE_PROFILES`（github→`/repo/{name}`，hackernews→`/hn/{id}`）+ `itemHrefFor`（替换 feed 里散写的 isGithub 二分支）。
- `app/hn/[id]/page.tsx` — HN 条目本地详情页（读本地 latest 该 objectID；无则 `notFound()` 404；展示标题/points/评论数/时间/story 正文（剥 HTML 按纯文本）/原文+HN 讨论外链；不走 AI、不判读）。
- `app/api/cross-digest/route.ts` — GET 只读（未命中 `{available:false}` 不耗 token）；POST 生成（`isUpdateRunning()` 409 → `acquireJob("digest",date)` → 生成 → `finishJob`；同任务在跑 `{running:true}`；错误 shape + 400/409/503/502）。
- `components/FeedSummary.tsx` — 首页综述块（复制 AiInsight 五态 + `autoStartedRef`；「生成中」轮询 peek 到命中自动展示）。
- `tests/feed.test.ts` 增跨源去重 case；`tests/{feed-text,canonical,grouping}.test.ts` 新增（单测集中顶层 `tests/`）。

修改：`core/domain/types.ts`（`FeedItem` 加 `groupId?`）、`core/store/file.ts`（`CROSS_DIGESTS_DIR`/`HN_HISTORY_DIR` 入 ensureDirs；`readCrossDigest/writeCrossDigest/listCrossDigests`；`readHnHistory/writeHnHistory/listHnDates`）、`core/sources/hackernews/adapter.ts`（写 latest 同时写当日 history 快照）、`core/config/features.ts`（`autoCrossDigest` 默认 false）+ `app/settings/page.tsx`（开关行）、`app/page.tsx`（挂 `<FeedSummary auto={autoCrossDigest && hasKey}/>`）、`components/{FeedCard,FeedBoard}.tsx`（详情入口走 profile；HN 标题链内部 /hn/[id]；exButton 恒显）、`app/hn/page.tsx`（标题链内部详情）、`cli/daily.ts`（步骤 5 跨源每日综述+跨源周报，需 key + autoCrossDigest + 单飞锁）、`README.md`、`docs/{architecture,execution-plan}.md`。

验证：`tsc`/`lint`/`test`(38)/`build:cli`/`next build` 全绿；curl：首页出综述块 + 两源板块；`/api/cross-digest?peek=1` 未命中 `{available:false}`、POST 生成 `data/cross-digests/{date}.md`、二次 peek `cached:true`；`/hn/{id}` 有效 200 / 无效 404；`/hn`/`/repo/{name}`/`/digest`/`/radar`/`/api/watchlist` 200 无回归。

### 「趋势榜对齐 Explore + 跨源综述提速」增量（2026-09-11，已验证 tsc/lint/test(45)/build:cli/next build/curl/浏览器截图）

**背景（用户报两 bug）**：①「今日跨源值得看」执行太慢（定时任务当日 90s 超时失败、手动点按挂 1-2 分钟）；② GitHub 榜单与 github.com/explore 趋势榜口径出入大、条目长期霸榜不变（根因：旧口径=Search `created:>30天` 按**总 star** 排——窗口内越早创建总 star 越高、越霸榜）。

**A. Explore 趋势榜（新口径，与新星榜并存不互斥）**
- 新增 `core/sources/github/trending.ts`：抓 `github.com/trending?since=daily` 页面（**无官方 trending API**，页面抓取不占 API 配额）、零依赖正则解析（`parseTrendingHtml` 纯函数导出供单测）。网络路径实测：api.github.com 直连稳定但 **github.com 页面直连常被重置** → 直连失败后自动回退代理（`GITHUB_TRENDING_PROXY`/`HTTPS_PROXY` env → 探测本地 `127.0.0.1:7897`），代理隧道= net CONNECT + tls.connect + `https.request({createConnection:(o,cb)=>cb(null,sock)})`（**同步 return socket 形式在 Node 24 https 下静默挂起，必须走 oncreate 回调**）。全失败 → null 降级，绝不阻塞更新。
- `updater.ts`：1.5 步与搜索**并行**发起抓取；趋势榜 **Top10 并入自动入池集**（与新星 Top10 并集，共享淘汰保护）；池拉取后对趋势榜缺详情的仓 `mapLimit(2)` 用 `/repos` 富化 topics/created/pushed/archived/license（独立局部停止标志，富化耗尽配额不算整轮失败）；`latest.json` 新增 `trending[]`（`TrendingRepo` 类型，`delta_1d` 语义=`stars_today`；抓取失败字段缺省）。**history 快照 writer 与 star 索引未动**。
- `feed.ts`：GitHub 板块**优先 trending**（`githubTrendingToFeedItem`：★总 star + ↑当日新增；**不剔 active chip**——趋势条目年限不限，活跃是真信号，与新星榜语义不同），无 trending 回落 new_stars；板块标题随口径「GitHub 趋势榜 / GitHub 今日热门」。
- `FeedBoard` GitHub 完整视图：顶部新增「GitHub 趋势榜」面板（RepoRow 复用，`trendingAsRow` 适配；trending 在场时新星榜默认收起）；`summarize.ts` 摘要合并循环补 trending。

**B. 跨源综述提速（三层）**
- **关思考**：`lib/deepseek.ts completeChat` 新增 `disableThinking` → `enable_thinking:false`（实测本机 Qwen 网关：`reasoning_effort:low` 只减不关推理，`enable_thinking:false` 才归零、快约一倍；provider 接口与 400 降级链同步扩展——不认该参数时回退 reasoning_effort）。`cross-digest.ts` 用它 + 文章改 **400-600 字 / maxTokens 1200**（慢的主因是网关解码 ~15-25 tok/s × 输出 token 数）。实测整链 **POST 12ms 应答、生成 ~12-40s 出稿**（旧：挂请求 1-2 分钟或 90s 超时失败）。
- **POST 全后台化**：`/api/cross-digest` POST 立即 `{ok,running:true}`，acquireJob+生成+finishJob 全在浮空闭包（连跨 kind 排队都不挂浏览器请求）；GET peek 未命中时带任务态 `{running}` / `{error}`（`cross-digest` kind 最近 10 分钟失败），`FeedSummary` 轮询 2.5s 收尾（命中→展示；error→红框重试；4 分钟无果→超时提示）。
- **锁 kind 归因修正**：跨源综述/周报不再复用 `"digest"` kind（旧：与 GitHub 每日洞察同日同 target **互相误判"已在跑"**，daily.log 今晨超时失败后浏览器补生成走的即此坑）→ 独立 `cross-digest` / `cross-weekly`（cli/daily 同步）。
- **僵尸锁修复（测试中挖出）**：dev 热重载杀后台闭包后锁 owner pid 仍存活、`isAlive` 判活失效 → 新任务被 `acquireJob` 静默排队 5 分钟。新增 `startLockHeartbeat()`（持锁期每 5s 刷锁 mtime）+ `tryTake`/`runningJob` 以 **mtime 心跳 >90s 判僵尸可回收**；**所有持锁方（3 路由 + cli/daily 4 处）必须包心跳 start/stop**，勿只给新任务加。

验证：45 测全绿（新增 `tests/github-trending.test.ts` 解析器 5 例 + feed trending 2 例）；`run-source.mjs github` 实测 16 条 trending 全富化、Top10 入池挤掉陈旧成员；浏览器截图确认 GitHub Tab 趋势榜版式；`/`、`/digest`、`/radar`、`/find`、`/settings`、`/repo/*`、`/hn`、`/api/watchlist`、`/api/gen-status` 200 无回归。

### 「GitHub 热榜存量榜（/hot）」增量（2026-09-11，已验证 tsc/lint/test(56)/build:cli/next build/实测 rebuild+probe+summarize+curl）

**范围**：独立页面 `/hot` 的**存量榜**（与首页「今日增量流」口径不混）——10 预设类目按 GitHub 查询式实拉 `search/sort=stars`，总 star 排序；分类 Tab 横切、只看关注复用全站 watchlist、判读 chips（长期未维护保留+标记）、技术性过滤出榜理由可见、一键重建 + 中文摘要增量预生成。**B 档：运行期零 AI**（纯 searchRepos），验证做在生成期（`probe` 体检命令）。

> **敏感内容规则按用户指示整体不做**：原共识的「政治敏感词命中出榜」这一条**未实现**（连关键词表都不落代码，避免对外可交代性/审查问题）。`core/domain/hot-filter.ts` 只保留两条**技术性**规则（归档/Fork/无描述/无 README/star 门槛 硬排除；超 1 年未维护交 signals 红 chip）。出榜记录 `HotFilteredEntry` 去掉 `matched` 字段，页面无任何关键词审查逻辑。将来若要加，独立另议，勿蹭本轮。

新增文件：
- `core/sources/github/hot.ts` — 采集器：`collectHotSections()`（逐类目跑 `queries + stars:>=生效门槛`，per_page 100，节流 1.6s、403/429 退避重试一次）+ `rebuildHotSnapshot()`（README 探测[核心配额、150ms 节流、404=确无则排除、限流/低配额即停并保留、缓存 `hot-readme.json`] → `assembleHotSections` → 挂 summaries → 类目内 star 降序截断 CATEGORY_MAX=80 → 写 `data/hot/latest.json`+history。退出码 0/1/2）。
- `core/config/hot-categories.ts`（上轮已建）— `readHotCategories/writeHotCategories/effectiveStarFloor`（全局硬门槛 5000，类目 floor 只增不减；非法条目跳过、空→[]）。
- `core/domain/hot-filter.ts`（本轮改）— 纯函数：`hardExcludeReason/excludeReasonFor/assembleHotSections`（类内跨查询去重→过滤→star 降序；出榜仓库级去重记全类目）。**政治敏感分支已删除**。
- `core/analysis/hot-probe.ts` — `runHotProbe()`：实跑当前 queries → `data/hot/probe-report-{date}.md`（各类目召回/入榜/top8/出榜原因分布）供人核对查询式质量（**入榜 0 → 提示过窄**）。零写业务快照。
- `core/analysis/summarize.ts` 增 `runSummarizeHot({max=80})`（复用抽出 `summarizeInto` helper 与 GitHub 摘要同一 `summaries.json`+`summaryKey`；跨类目去重、单次上限、幂等续跑；回写快照 summary）。
- `app/hot/page.tsx` — 服务端读 `readHotLatest` → `hotRepoToFeedItem` 预映射 + `watchedKeySet`；无快照显示生成引导。
- `components/HotBoard.tsx` — 分类 Tab / 只看关注 / FeedCard 列表 / 「已过滤仓库」CollapsiblePanel（原因徽标）/ 底部重建说明。
- `components/HotRebuildButton.tsx` — POST `/api/hot` 后台起 `dist/cli/hot.mjs rebuild`，轮询 GET，完成自动刷新（限流 code 2 也刷新）。
- `app/api/hot/route.ts` — POST detached spawn 重建（`hot-state.json` 记 pid，仿 update 进程重启识别）；GET `{running,lastResult}`。
- `cli/hot.ts`（+ esbuild 入口）— `rebuild`(默认)/`probe`/`summarize`。
- `core/sources/github/api.ts`（上轮已建）— 从 updater 抽出的共享 REST 客户端（`searchRepos(perPage)` 等），updater 与 hot 共用；本轮 hot 复用之。
- `data/config/hot-categories.json`(+`.example`) — 10 类目查询式（git 可 diff 的真相源；实测经 `probe` 迭代：TV/嵌入式两轮从近空补到 15/74）。
- `tests/hot-filter.test.ts`（含**无关键词审查**回归：敏感向文字照常入榜）+ `tests/hot-feed-mapping.test.ts`。

修改：`core/domain/types.ts`（`HotCategoryConfig/HotRepo/HotCategorySection/HotFilteredEntry(去 matched)/HotLatest`）、`core/store/file.ts`（`HOT_DIR/HOT_HISTORY_DIR/HOT_README_CACHE_FILE` + 读/写热榜快照/history/list、readme 探测缓存、`ensureDirs`）、`core/analysis/feed.ts`（`hotRepoToFeedItem`，保留 active chip）、`cli/daily.ts`（步骤 1.6 热榜重建 + 步骤 2 热榜摘要增量，非致命告警口径）、`components/Sidebar.tsx`（`/hot` 导航项「GitHub 热榜」）、`scripts/cli-build.mjs`（hot 入口）、README。

**改名「技术热点追踪」**（共识第二节，共 5 触点）已落地：`Sidebar.tsx` label、小屏简写串（`技术热点追踪`→`热点`）、`FeedBoard.tsx` 源 Tab「技术热点追踪」、README（配置/功能一览/首页段/`/` curl）、execution-plan §5。站名「极客信息聚合站」不动，路由/存储/组件名不动。

验证：`tsc`/`lint`/`test`(56)/`build:cli`/`next build` 全绿；**实测**（联网+Token，`loadCliEnv`）：`probe` 出报告（召回 633→调 tv/embedded→rebuild 613 入榜/28 出榜，全 archived/no-desc）；warm rebuild 从 244s（旧 36 查询+无节流）降到 **102s**（27 查询+1.6s 节流+README 探测节流/限流早停）；`summarize` 单轮 80 条、幂等报「还剩 533」；`/hot` 200 渲染 613 卡 + 分类 Tab + 出榜面板，`/api/hot` POST→GET `running:true`→完成 `code 0`，`/hn`/`/` 等无回归。

### 「刷新提速稳定化 + 详情页 AI 区块收起」增量（2026-09-15，已验证 tsc/lint/test(56)/build:cli/next build + 实测计时/浏览器）

**背景（用户反馈）**：更新数据与详情页 AI（判读/评测/同类/翻译）等待感重；打开详情页即见大块加载占位（用户开着 autoVerdict/autoReview/autoSimilar 三开关，旧行为=挂载直接生成、auto 大骨架铺满屏）。

**A. 更新链路提速与稳定**（全在 core/cli，零行为回归）
- `updater.ts` **快路径两段写**：搜索 + 趋势榜页面一完成（实测 **17s**）先写 latest.json（新星/趋势用已到手数据 + 缓存摘要，**追踪池沿用上次**，`readLatest` 取旧 tracked），首页秒级可见；池详情/富化完成后步骤 6 全量终写覆盖。失败仅告警不影响终写。
- `updater.ts` 趋势富化并发 `2 → 配额充足时 6`（与池同款 `remaining>200?6:2`）。实测整轮 `run-source all` 墙钟 **31s**（此前分钟级）。
- `cli/run-source.ts` all 模式**各源并发**（Promise.all；各源写各自 latest 文件互不相干）；退出码聚合语义不变（/api/update 兼容）。
- 新增 `core/sources/fetch-retry.ts` `fetchWithRetry`：juejin/cnblogs adapter 接入（瞬时网络错误/超时与 429/5xx 退避重试 2 次；其它 4xx 视为契约问题不重试）。昨日实测「fetch failed」抖动即属此类。

**B. AI 生成提速**：`/api/{verdict,review,similar}` completeChat 统一加 `disableThinking:true`（+reasoningEffort low 兜底降级），沿用跨源综述已验证口径（本机 Qwen 网关 enable_thinking:false 约快一倍；review 原本无任何 opts，补 disableThinking + 90s 超时）。

**C. 详情页 AI 区块默认收起**（核心 UX）
- 新增 `components/AiCollapseRow.tsx`：一行状态条外壳（标题 + hint + 状态徽标「检查中…/✓已生成/未生成/生成中…/失败/未接入 AI」+ 展开/收起），`usePersistedOpen(storageKey)` 把展开偏好记 localStorage（`aiPanel:{repo}:{kind}`，读写失败静默）。
- `AiInsight`/`SimilarProjects` 重构为消费该外壳：**挂载永远只 peek 缓存**（不耗 token，收起态徽标据此回填）；**auto 开关的自动生成延后到首次展开**才触发（autoStartedRef 守卫；展开即代表用户想看）；body 仅展开时渲染。三卡由「并排双栏 + 独立 h2」改为 **space-y-3 单列三行**。
- 实测（真实浏览器）：有缓存仓库三行全收起、徽标「已生成」、0 骨架块；点开判读 → 秒出 557 字缓存正文、不重新请求 AI；其余行保持收起。

修改面：`components/{AiCollapseRow(新),AiInsight,SimilarProjects,UpdateButton(上一轮),HotRebuildButton(上一轮)}`、`app/repo/[owner]/[name]/page.tsx`、`app/api/{verdict,review,similar}/route.ts`、`core/sources/{fetch-retry(新),juejin/adapter,cnblogs/adapter,github/updater}`、`cli/run-source.ts`、README。未动：feed/watchlist/daily 步骤结构、锁、热榜、详情页服务端直出部分（信息卡/chips/star 趋势）。



### 「产品优化轮 · M0 可用性与可信度基线」增量（2026-09-18，规格=`docs/product-optimization-plan.md` §6，已验证 tsc/lint/test(65)/build:cli/next build/无头浏览器实测/curl）

**M0.1 移动端布局阻断修复**
- `app/layout.tsx`：根容器 `flex` → `flex-col md:flex-row`（小屏纵向：导航在上、主内容在下，消除"导航横排挤出主内容"的 594px>390px 溢出）；主内容容器 `w-full min-w-0 flex-1`；统一 `pb-4` 叠加各页自身 pb-16，滚动到底时末行内容完全避开右下角浮动按钮带（72px）。未用全局 overflow-x hidden。
- `components/Sidebar.tsx`：移动导航 `w-full min-w-0 overflow-x-auto`（复用 hscroll-thin 皮肤）+ 子项 `shrink-0 whitespace-nowrap`——导航占满视口宽、超宽入口条内自滚动；桌面/移动 active 高亮口径统一（`isNavActive`，/repo* 归属首页）。
- `components/TranslateWidget.tsx`：浮动翻译按钮小屏隐藏（`hidden md:flex`，§12.4 减少双按钮遮挡）；README 页内已有「AI 翻译」按钮，功能不断链；聊天按钮保留。
- 实测（sky-browser）：7 页面 × 320/390/768/1280 四档 `documentElement.scrollWidth == clientWidth`、主内容首屏可见；390px 导航 437px 内容条内滚动、当前入口高亮正确（含 /repo 详情页→热点）。

**M0.2 AI 产物来源版本与过期状态**
- 新 `core/domain/artifact.ts`（纯函数）：`ArtifactMeta{schemaVersion:1,kind,generatedAt,sourceDate,sourceUpdatedAt,sourceFingerprint,model}`；`fingerprintOf`（sha1-12，与既有 verdict/similar 文件名指纹同口径）；`coarseBucket`（2 位有效数字量级桶）；`freshnessOf`→ fresh/stale/legacy 三态。
- 新 `core/store/artifact.ts`：sidecar `<主文件>.meta.json`（Markdown 主文件零改动、旧读取路径零影响）；`writeArtifact`（先内容后 meta，绝不"有 meta 无正文"）；`readVersionedArtifact`（当前指纹精确命中优先，否则回退同前缀最新旧版本——stale 要显示旧正文而不是报"未生成"）。
- 首批四类接入：
  - **跨源综述**（`core/analysis/cross-digest.ts` + `/api/cross-digest`）：指纹=实际喂入的 feed-text 块（同日"立即更新"后条目/度量变 → stale）；POST 改为 force 覆盖重生成（cli/daily 自动仍幂等）；GET 带 `freshness/meta/running/genError`（重生成失败旧正文+错误，成功且产物晚于失败则错误自动消失）。
  - **判读**（`/api/verdict`）：提示词移除 star/增量/话题行（结论不引用易变运营指标 → 指纹可排除之，缓存保持稳定）；指纹含 language（进入提示词）。验收"改维护/许可/描述 → stale"实测通过；输入回改即恢复 fresh（同输入=同指纹的缓存语义）。
  - **评测**（`/api/review`）：正文引用热度 → 喂给模型 2 位有效数字约数并令其只引用约数，指纹含量级桶（日内小漂移不误过期、量级/描述变化即 stale）；文件名不变（兼容旧缓存），meta 走 sidecar。
  - **同类**（`/api/similar`）：meta 内嵌 JSON（该产物本体是 JSON）；sourceFingerprint=仓库身份指纹+今日池 updated_at（池刷新=数据已更新）；TTL 语义保留，过期/指纹变都归 stale；精确未命中回退最新旧文件。
- 界面统一七态（M0.2 §界面状态清单）：`AiCollapseRow` 徽标扩为 未生成/生成中/已生成·基于最新数据/数据已更新·可重新生成/历史缓存·依据时间未知/生成失败·可重试/未接入 AI（颜色按 §12.2：stale=蓝不作错误红、legacy=灰）；新 `components/ArtifactProvenance.tsx`（溯源行"生成于/数据更新于/模型" + stale/legacy/failed 三条提示条，带重新生成入口）；`AiInsight`/`SimilarProjects`/`FeedSummary` 接入——旧正文始终保留展示，重新生成在旧文下方进行不顶替；auto 自动生成只对 missing 触发（stale 保守不自动烧 token）。
- 兼容与纪律：不批量改写 `data/`；旧无 meta 缓存=legacy 可读不 500；重新生成失败保留旧内容+展示错误；无 key（503→未接入 AI 文案）/上游 401（genError 红条+旧文）/旧缓存（灰条）三种状态文案不同（实测各异）。digest/weekly 元数据留 M4 补齐，共享结构自本节起复用。
- 文件速查：新 `core/domain/artifact.ts`、`core/store/artifact.ts`、`components/ArtifactProvenance.tsx`、`tests/artifact.test.ts`（9 用例）；改 `app/api/{verdict,review,similar,cross-digest}/route.ts`、`core/analysis/cross-digest.ts`、`components/{AiCollapseRow,AiInsight,SimilarProjects,FeedSummary}.tsx`、`app/{layout,page 无关}`、`components/{Sidebar,TranslateWidget}.tsx`、`core/domain/types.ts`（SimilarResponse +freshness/meta/genError）。

### 「产品优化轮 · M1 今日必须看」增量（2026-09-18，规格=`docs/product-optimization-plan.md` §7，已验证 tsc/lint/test(82)/build:cli/next build/无头浏览器实测）

**结构（§7.2）**：首页改为 ① 标题/数据时间/更新 → ② 「今日必须看」简报卡（默认展开，用户收起过则记住偏好；`usePersistedOpen` 加 defaultOpen 参）→ ③ 异常变化（无变化不渲染）→ ④ 完整信息流（**聚合视图各板块默认收起**——首屏让给简报，§7.6；单源 Tab 与 GitHub 完整视图不在此列）。原独立「今日跨源值得看」大段 Markdown **并入简报卡底部**（FeedSummary 作为 children，收起一行入口，功能与 M0.2 新鲜度全保留）。

**确定性选择 + AI 只写解释（`core/analysis/briefing.ts`）**：
- `selectBriefingItems`（纯函数）：GitHub=当日绝对增量线性 0-34 + 榜位地板 0-8 + 相对增幅(≥10%)≤10 + 跨源同主题 +14 + 新入视野 +10 + 关注 +8（关注是加权不是证据）；文章源=源内名次 0-26（**绝不跨源数值混排**）；负面=归档 -40 基本出局/红 -18/黄 -6/无许可 -6 并挂风险标签；总量 ≤5、单源 ≤3、score<10 不硬凑。证据 1-3 条全可核实（“今日新增 star +3,286（GitHub 趋势榜第 1）”式）；模板理由=前两条依据拼接（**无 AI Key 全功能可用**）。
- AI 润色：一次调用为已选 ≤5 候选各写一句 ≤25 字理由（禁数字/禁增删候选/顺序一致）；解析=**keyed 优先 + 无 key 时行数严格相等才按序对齐**（网关实测模型会丢 key 且写全角｜，绝不错位张冠李戴）；AI 失败/无行 → 缓存逐条 `ai:true/false` 标记来源，界面不冒充 AI + note 说明。
- 缓存 `data/cache/briefing/{date}.json`（§7.5 形状：date/sourceUpdatedAt/sourceFingerprint/generatedAt/items[{key,reason,evidence,ai}]）——**只存选择结果与解释，事实每次从 FeedItem 现算**（无指标漂移）。指纹=选择身份(key/rank/增量量级桶/分组/关注/风险)+池 updated_at：同日更新数据后 pool 变 → **stale 可重建**（实测）；日内数字小漂移不假过期。`/api/briefing` GET 零 token 直读、POST 才烧 token（数据更新中 409）；新 `autoBriefing` 开关（默认关，auto=挂载补一次，StrictMode ref 守卫）。
- 异常变化（`core/analysis/anomalies.ts`，全确定性）：关注项目加速/降温（近 7 日日均 ≥50 且今日 ≥3×/≤⅓）、归档翻牌、许可 明确→缺失/变更（NOASSERTION 视作缺失不误报）、启用源无板块/抓取非今日；无变化不渲染面板。
- 简报行 UI：名次点 + 关注（乐观更新复用 /api/watchlist）+ 标题（站内详情 + 原文外链双入口）+ 度量 + 同主题跨源×N 互链 + 一句理由（AI/模板标）+ 依据 chips + 风险标签；「加入对比」按钮 M3 对比篮落地时接入。
- 验证：浏览器实测桌面/390/320 简报五卡布局、stale 蓝条（保留旧推荐语+“条目与数字为当前值，可信”说明）、跨源综述并入行；`selectBriefingItems`/`parsePolish`/`detectAnomalies` 共 20+ 单测用例；同主题/新入视野/加速降温等文案与 §12.1 统一口径（“今日首次被本站发现”非“新项目”）。
- 文件速查：新 `core/analysis/{briefing,anomalies}.ts`、`app/api/briefing/route.ts`、`components/BriefingSection.tsx`、`tests/{briefing,anomalies}.test.ts`；改 `app/page.tsx`、`components/{FeedBoard,BriefingSection,AiCollapseRow}`、`core/config/features.ts`（autoBriefing）、`core/store/file.ts`（BRIEFING_DIR/listGithubHistoryDates）、`settings/page.tsx`（开关行）。

### 「产品优化轮 · M2 关注中心与持续跟踪」增量（2026-09-18，规格=`docs/product-optimization-plan.md` §8，已验证 tsc/lint/test(82)/build:cli/next build/无头浏览器实测/关注-采样-取消往返实测）

- **`/watch` 关注中心**（新 `app/watch/page.tsx` + `components/WatchBoard.tsx`）：服务端合并 watchlist × 今日 feed × latest.tracked 装配行（客户端只做过滤/排序/取消）。顶栏：关注总数 · 今日有变化数 · 数据更新于；过滤全部/GitHub/文章，排序最近变化/最近关注/名称；行=标题（站内详情+原文双链）+ 原生度量 + 今日增量（绿）+ 最近变化摘要 + 关注时间 + 取消关注（乐观移除、失败回滚）。**五态**：live（今日在榜/已采样）· offlist（离榜文章用快照：标题/URL/最后度量/最后记录日期，§8.4 第一版不持续抓文章指标）· sampling（新关注 GitHub 仓：「已加入每日采样，趋势数据从下一次更新开始积累」）· stale（配额回退：「数据为 X 的最后已知记录」不冒充刚更新）· legacy（旧记录无快照：「历史关注 · 未记录标题与度量」）。空态解释三个加入入口 + 去首页/热榜按钮（§12.3）。
- **数据兼容（§8.5）**：`WatchlistEntry` 扩展 `note?/snapshot?{title,url,description,lastMetricLabel,capturedAt}`——全部可选，`{source,source_id,addedAt}` 旧记录照常读取；`toggleWatchlist` 新增第三参 snapshot（仅新增分支写入，取消无副作用）。`/api/watchlist` POST 接受前端随请求附带的快照（宽松消毒：非法形状忽略不拒整个请求；title/url 截 200/500）。三处点星入口（FeedBoard/HotBoard/BriefingSection）统一改走新 `components/watchApi.ts`（`postWatchToggle`+`watchSnapshotOf`），加入关注即捕获展示信息。
- **GitHub 持续采样（§8.3）**：`core/sources/github/updater.ts` 本轮拉取集合 = **配置池 ∪ 关注中的 GitHub 仓库**（`fetchPool`）——关注仓进 latest.tracked/history/star-history 积累趋势，但 **writeTrackedRepos 只写配置池**：关注仓不污染 `tracked-repos.json`，取消关注永不触碰该文件（实测：关注 vite/awesome→跑更新→tracked/history 有、配置池仍 60 不含它们）。拉取失败/限流的仓回退昨日 history 的 last-known 行并标 `TrackedRepo.dataUpdatedAt`（新增可选字段），`delta_1d=null` 不冒充刚更新；`tracked_updated` 只计本轮真实更新数（回退行不算）。关注新仓即时出现在 `/watch`（sampling 态），无需等第二天。
- 侧栏/移动导航新增「关注」项（isNavActive 统一高亮；390 宽无溢出）；首页/热榜「只看关注」保留为快捷过滤不动。
- 文件速查：新 `app/watch/page.tsx`、`components/{WatchBoard,watchApi}.ts(x)`；改 `core/domain/types.ts`（WatchlistEntry.snapshot/note、TrackedRepo.dataUpdatedAt）、`core/store/file.ts`（toggleWatchlist 快照）、`app/api/watchlist/route.ts`、`core/sources/github/updater.ts`（fetchPool 并集+last-known 回退）、`components/{Sidebar,FeedBoard,HotBoard,BriefingSection}.tsx`、README。

### 「产品优化轮 · M3 项目决策与对比」增量（2026-09-18，规格=`docs/product-optimization-plan.md` §9，已验证 tsc/lint/test(95)/build:cli/next build/浏览器实测/AI 往返）

- **判读+评测合并为「项目决策」**（§9.1 固定八块）：新 `components/ProjectDecision.tsx`（单条 AiCollapseRow，body=结论徽标→AI 四段解释（适合/不适合/为什么现在值得看/尚无法判断，含 M0.2 七态徽标与 stale/legacy/failed 提示条）→确定性事实区→风险→溯源行）；旧 `AiVerdict/AiReview` UI 下线（`/api/verdict`、`/api/review` 路由保留为兼容接口，无页面引用；`components/AiInsight.tsx` 删除）。详情页 AI 区从三行变两行（决策+同类）。
- **职责切分（§3.1 确定性优先落地）**：结论=纯规则（归档/超365天=仅供参考；确无许可=谨慎投入；≤30天活跃+增量/趋势=推荐尝试；其余=继续观察），风险=chips/事实派生，事实=每次现算（**不入库、零漂移**）；AI 只缓存四段文字（`data/cache/decisions/{o}__{n}__{指纹}.md` + sidecar，kind=decision）。指纹输入=喂入请求的全部稳定事实（描述/许可/维护三态/话题/量级桶 coarseBucket/池时间/趋势样本数/README 哈希+部署行）；**release 不进指纹**（可选补充请求的配额抖动不假报过期）；实测描述改动→stale（旧解释保留可重建）、恢复→fresh。
- **输入事实（§9.2）**：`lib/decision.ts` 装配——pool 行优先否则 getRepo 实时（license/archived 三态保真）；README 走既有缓存（无则一次拉取+写缓存，与查看器共用）→ `core/domain/decision.ts#readmeDigest`（sha1-12+标题+部署/安装行≤4）；release 一次可选请求（8s 超时静默降级 → 进「未看到正式发布」+风险）。prompt 纪律：不引用数字、不从 star 推质量、「未看到/未采集」项不得声称存在（实测 whyNow 曾谎称有 release，纪律强化后正确）。
- **详情页事实区（§9.3）**：统计条 4→8 项（star/近日增量(自然日口径 tooltip)/fork/open issues/语言/许可证三态/最后推送/创建时间）+ 口径脚注（数据时间、「—=未采集非无」）；管道补字段：`pickRepoFields/RepoInfo/GhItem` 加 forks/open_issues，`NewStarRepo/TrackedRepo/TrendingRepo` 可选字段（旧快照显 —，下次更新起有值）；StarTrendChart <3 天样本注「样本不足，暂不能判断趋势」仍照常画图。
- **对比（§9.4/§9.5）**：`components/compareStore.ts`（localStorage 全局对比篮 ≤4 GitHub 仓；useSyncExternalStore；**SSR 快照必须模块级常量数组**——返回新数组触发无限重渲染死循环，实测踩坑；storage 事件跨标签同步）+ `CompareButton`（6 处入口：今日简报/信息流 GitHub 板块/热榜卡片/AI 寻找结果/详情页头部/同类项目行——非 GitHub 条目不显示）+ `CompareTray` 左下浮条（`md:left-[16.5rem]` 让开侧栏，勿盖设置钮）+ `/compare` 页（`CompareBoard`）：GET `/api/compare` 零 AI 事实矩阵（定位/star+近7日增长(明确起止日期，样本不足标注)/fork/issues/最后推送/许可证/语言/创建/release/归档维护风险/README 部署线索(仅读缓存不现拉)），列头可移出、空态/单候选态有引导；POST 场景建议=AI 只引矩阵字段+**定位与场景不对口不得推荐**（实测已从「首推不相关仓」修正为排除后推荐 Ghidra 并带缺失提醒）。单仓 GitHub 请求异常/挂起只让该仓缺席（withTimeout+catch），绝不 500 炸整张矩阵（api.github.com 突发并发偶发重置）。
- **同类质量门槛（§9.6）**：`core/domain/hot-filter.ts#similarCandidateDisqualifies`（归档/0 star/无描述且无话题=信息缺失）在本地候选与搜索候选收集期统一过滤；AI 保留 <3 个时 note 明说「宁缺勿凑」；每行加「加入对比」。
- **功能开关**：`autoVerdict/autoReview` → **`autoDecision`**（合并语义；FEATURE_DEFAULTS 默认 false；本机 data/config/features.json 已按用户原意迁移为 autoDecision:true）。
- 环境备忘：本轮出现 dev 长时间热重载后**客户端 chunk 陈旧**（新组件挂载 effect 完全不执行、无报错）——重启 `next dev` + 清 `.next/dev` 即愈；后续会话遇到「代码逻辑对但页内行为缺席且零错误」优先怀疑此项。
- 文件速查：新 `core/domain/decision.ts`、`lib/decision.ts`、`app/api/{decision,compare}/route.ts`、`components/{ProjectDecision,CompareBoard,CompareButton,CompareTray,compareStore}.ts(x)`、`app/compare/page.tsx`、`tests/decision.test.ts`；改 `core/domain/{types,hot-filter,artifact(kind+briefing)}.ts`、`core/sources/github/{api,updater}.ts`、`core/config/features.ts`、`app/api/similar/route.ts`、`app/repo/[owner]/[name]/page.tsx`、`components/{SimilarProjects,BriefingSection,FeedCard,FeedBoard,HotBoard,ProjectFinder,Sidebar,StarTrendChart}.tsx`、`app/settings/page.tsx`。

### 「产品优化轮 · M4 趋势与报告行动化」增量（2026-09-18，规格=`docs/product-optimization-plan.md` §10，已验证 tsc/lint/test(101)/build:cli/next build/浏览器实测/force 重生成往返实测）

- **颜色统一（§12.2 随本轮落地）**：正向增长全站改绿（`DeltaBadge`、雷达语言/主题增量），红色只保留给风险/失败语义。
- **雷达可视化（§10.1，零图表依赖手绘 SVG）**：`lib/radar.ts` RadarRow 加 `spark`（≤10 点快照序列，锚定收盘日过滤）+ `RadarData.topicWeeks`（top8 主题 × 近 5 个 7 日窗增量，无数据窗=null 画虚线占位不画假 0）；新 `components/RadarTopPanel.tsx`（客户端）：「绝对增长 ⇄ 相对增幅」切换排序（两口径不混排）、每行 `Sparkline`（components/Sparkline.tsx，累计增量归一防大 star 压平）、勾选 2-5 仓 → `OverlayChart` 叠加对比（横轴=距收盘日天数、纵轴=相对各仓首点累计增长，配色图例带增量值）——实测三曲线正确；降温行给前后双时段迷你柱（不再只有 ratio）；主题行给逐周迷你柱；「本周新入视野」→**「本周首次被本站发现」**+ 释义「首见=进入本站快照，不代表仓库刚创建」（§12.1）。
- **日报/周报来源版本（M0.2 约定补齐）**：`lib/digest.ts` 生成写 `.md.meta.json`（kind=digest；**sourceFingerprint=实际喂入的新星 Top20+追踪池增量 Top10 文本块哈希**，非日期；sourceUpdatedAt=latest.updated_at）+ `digestFingerprintToday()` 重算比对；`lib/weekly.ts` 同（kind=weekly；指纹=喂入 prompt 哈希，历史周不可变→存档天然成立）+ `readWeeklyMeta`；`/api/digest` POST 加 `?force=1`（过单飞锁覆盖重生成；旧产物在成功前原样保留，实测中途 abort 不损坏文件）。
- **洞察页（§10.2）**：每篇头部「生成于 / 数据覆盖 / 信息源 / 状态」行——当日按指纹判 **已生成·基于最新数据（绿）/ 数据已更新·可重新生成（蓝+重新生成按钮 `DigestRegenerateButton`）**，历史篇「当日存档」，无 sidecar 旧产物「历史存档·依据时间未知」；新 `components/DigestMarkdown.tsx` 统一渲染洞察/周报：正文点名仓库（`**o/r**`、`` `o/r` ``、github.com/o/r 链接）自动补站内详情链接（`core/domain/repo-refs.ts#linkifyRepoMentions`，`extractRepoRefs` 按文本位置保序去重拒绝 docs/、文件后缀、and/or 等伪仓库；tree/blob/issues 深链保持外跳）；文末「文中点名 · 快捷操作」行动区（`RepoActionList`：关注☆/加入对比/站内详情）——实测今日洞察 17 篇条目带出 2 处徽标+行动区正常。
- **超时口径**：digest/weekly AI 调用 120s→**240s**（800-1200 字长文在本机网关 ~15-25 tok/s 常超 120s，实测 force 重生成一次 120s abort、240s 成功）。
- 390px 两页无文档级溢出（雷达叠加/主题柱均随容器缩放）。
- 文件速查：新 `components/{Sparkline,RadarTopPanel,DigestMarkdown,RepoActionList,DigestRegenerateButton}.tsx`、`core/domain/repo-refs.ts`、`tests/repo-refs.test.ts`；改 `lib/{radar,digest,weekly}.ts`、`app/radar/page.tsx`、`app/digest/page.tsx`、`app/api/digest/route.ts`、`components/RepoRow.tsx`（DeltaBadge 绿）。

### 「产品优化轮 · M5 寻找、数据源和兴趣偏好 + 导航 IA 收口」增量（2026-09-18，规格=`docs/product-optimization-plan.md` §11/§4，已验证 tsc/lint/test(107)/build:cli/next build/无头浏览器实测/320-1280 全页面溢出矩阵）

- **AI 寻找升级（§11.1）**：
  - 首次进入给**可点击示例**（本地部署大模型 / React 数据可视化 / 自托管团队知识库 / PDF 转 Markdown / Rust 桌面应用），不再大面积空区；
  - **结果筛选**（语言[从结果动态收集] / 最低 star / 更新时间 30/90/365 天 / 许可证明确与否 / 隐藏归档）：`FindStore#passFilter` 纯函数客户端即时过滤（不重发请求），随 find:state 持久化（刷新后按既定策略保留），筛选后计数/全被过滤空态都带「清除筛选」；
  - **搜索条件摘要 + 一键清除**（查询/许可证模式/排序/生效筛选 chips）；
  - 结果行新增：**「为什么匹配」字段级解释**（新 `core/domain/find-explain.ts`：`queryTermsOf` 拉丁词+CJK 短语提取（停用词表防 to/of 短词）、`explainRepoMatch` 话题/描述/名称/语言/多路命中 ≤3 条、全不命中给透明兜底不编造；`/api/find` 合并时跟踪 hitQueries/hits 喂入并缓存 `why` 字段，旧缓存缺省优雅隐藏）+ 最后推送与许可证展示 + **关注☆与加入对比**动作；
  - **口径修正**：「仅开源/非开源」→「不限许可证/许可证明确/无明确许可证」+ 释义（公开仓库无许可证≠私有项目）；find 结果安全空态文案软化。
- **数据源管理（§11.2）**：新 `/api/sources`（GET：registry 全源+active+**最后成功更新时间**[github=latest.updated_at，其它=source latest.fetched_at]+网络要求说明[registry 新增 `networkHint` 字段，HN=需梯子]；POST：写现有 `active-sources.json`，校验未知 id/至少一源，顺序按 registry 稳定化）+ 设置页「数据源」卡（`SourceManagerCard` 开关乐观更新失败回滚，标注不另建重复配置）。实测开/关/非法/清空四路径正确。
- **兴趣偏好（§11.3）**：新 `core/config/preferences.ts`（`data/config/preferences.json`：languages/topics/negativeTopics/bias=new·mature·neutral；cleanList **条目内再按逗号/顿号/空白拆分**防整串误存、小写、限长 40 超限丢弃）+ `/api/preferences` GET/POST + 设置页「兴趣偏好」卡（`PreferencesCard`，界面明示边界「只影响今日必须看加权，不改变原始榜单与信息流」）。**简报接入**：`collectBriefingInput` 读偏好 → raw 项带 prefLang/prefTopicHits/prefNegativeHits/prefBias；`selectBriefingItems` 加权（主题≤16+证据「匹配你的关注主题「x」」、语言+8+证据、负面主题 -30/条封顶 -45 沉底不删除、bias=new 新入视野再+8/mature 万 star 老仓+8）；**偏好进入指纹**（改偏好 → 简报标 stale 可重建，实测生效）；feed/榜单/热榜不受偏好影响。
- **导航 IA 收口（§4，全里程碑完成）**：侧栏顺序调为 今日·热榜·寻找·**关注·对比**·洞察·雷达·设置（= 今日/发现/关注/对比/报告 目标 IA 的逐项映射；保留现描述性 label，不引入「发现/报告」聚合新词——单用户自用可读性优先，文档允许“未特别修改时采用默认值”，此处默认值“接受”指入口能力而非强制改名）。
- 文件速查：新 `core/domain/find-explain.ts`、`core/config/preferences.ts`、`app/api/{sources,preferences}/route.ts`、`components/{SourceManagerCard,PreferencesCard}.tsx`、`tests/{preferences,repo-refs}.test.ts`；改 `components/{FindStore,ProjectFinder}.tsx`、`app/api/find/route.ts`、`lib/find-cache.ts`、`core/analysis/briefing.ts`（偏好加权+指纹）、`core/sources/registry.ts`（networkHint）、`app/settings/page.tsx`（两新卡）、`components/Sidebar.tsx`（顺序）。
- 环境备忘：`data/config/watchlist.json` 测试后已恢复 `[]`、`preferences.json` 已删除（回到无偏好默认）；今日 digest/cross-digest/briefing 为真实新产物保留。

---

### 产品优化轮 · 总验收（2026-09-18）

- **每里程碑独立验证**：`npm test` 56→107 全绿、lint 0 警告、`tsc` 干净、`next build` 成功；涉及 core/cli 的每步均重跑 `npm run build:cli`。
- **视口矩阵**（sky-browser 无头 Chrome 实测）：320/390/768/1280 × 首页/热榜/寻找/关注/对比/洞察/雷达/设置/仓库详情 —— 文档级零横向溢出、主内容首屏可见、移动导航条内自滚动；compare 表窄屏容器内横滚。
- **新鲜度矩阵**：判读/评测/同类/跨源综述/简报/决策/日报/周报全部带来源版本（sidecar 或内嵌 meta），数据更新 → stale+可重建 往返实测；无 key（503→未接入 AI）/上游失败（genError 保旧文）/旧缓存（legacy）三态文案各异。
- **无 AI Key 核心可用**（§3.5）：简报（模板理由+确定性依据）、决策卡（结论/事实/风险）、对比矩阵、关注中心、趋势图、快捷拉取均不依赖 AI；AI 部分仅为增强层。
- **边界（§3.6/§16）**：未引入账号/数据库/远程依赖/大型 UI 库；AI 不触碰关注/配置/追踪池（偏好只影响简报加权）；`data/` 运行数据不入库。
- - 遗留风险：见各节；dev 长时间热重载 chunk 陈旧问题记录在 M3 节末环境备忘。

### 「体验修复：设置页对齐 + 页面切换性能」增量（2026-09-21，用户反馈两问题）

- **设置页布局对齐**：此前两排独立 `grid-cols-2`——第二排（数据源/兴趣偏好）整体对齐到第一排**最高卡**底部，AI 接入卡（短）与 功能设置（很高）并排拉扯出大片空洞；且数据源/偏好排在 `loading` 分支外，加载前后结构跳变。改为**两个列栈**（左列=AI 接入+数据源、右列=功能设置+兴趣偏好，`flex flex-col gap-6` 各自流内排列，互不拉扯），新增 `CardSkeleton` 与 Card 同外形消除加载跳动。
- **页面切换卡顿（根因与修复）**：
  1. **全站 force-dynamic + 无 loading.tsx** → 按 Next 16 导航模型（node_modules/next/dist/docs §linking-and-navigating）：动态路由没有 loading.tsx 时**预取完全跳过、点击后必须干等整页服务端响应**。新增 `app/loading.tsx`（通用骨架，形似首页版式）——效果：Link 进入视口/悬停即预取外壳、点击秒出骨架、内容就绪无感替换。**体感改善主因**。
  2. **重复解析热点**：一次首页渲染多处读同一份大 JSON（buildFeed 逐源 readSourceLatest + readLatest、简报再读 latest+watchlist+≤10 history、异常变化再读 latest+watchlist+≤8 history、readme/star-index…）。`core/store/file.ts` 新增**文件级 mtime+size 版本键缓存**（`slotFor/readTextCached/readJsonCached`）：命中只 stat 不读不 parse；全部写入走 atomicWrite（rename 必刷 mtime）→ 永不读到旧值，CLI 子进程写入对 web 进程同样即时生效；latest/sourceLatest/history/summaries/star-index/watchlist/tracked-repos/readme/digests/radars/cross-digests/hn-history/hot 快照与探测缓存全部接入。⚠️ **缓存槽返回共享对象引用**——会先改后写的消费方必须浅拷贝（summarize.ts 两处 `{ ...readSummaries() }` 已处理；latest/hot 快照行「改完即写盘、mtime 自愈」可接受）。
  3. **共享 chunk 瘦身**：Chat/Translate 两浮动窗带 react-markdown 等重组件挂在根布局会进每个页面首屏 JS——新增客户端边界 `components/FloatingWidgets.tsx`（`dynamic(...) + ssr:false`，本版文档规定 ssr:false 只能放 Client Component 内），根布局只引此包装；CompareTray 轻量保留静态。
- 验证：tsc/lint/test(107)/build:cli/next build + 浏览器切换走查 + 设置页两列目检（结果见提交说明）。
- 文件速查：新 `app/loading.tsx`、`components/FloatingWidgets.tsx`；改 `core/store/file.ts`（缓存层+16 个读函数）、`core/analysis/summarize.ts`（两处浅拷贝）、`app/layout.tsx`、`app/settings/page.tsx`（列栈+骨架）。
- 环境备忘：本轮 Bash 安全分类器多次限流（glm 侧 rate-limit），验证在恢复后补跑。

---

## 3. 可复用基建 / 设计约定（新代码必须遵守）

- **数据驱动**：一切内容来自 `data/`；加字段＝改 `scripts/update-trending.mjs` 白名单（`.mjs` 零依赖不能 import TS lib，重复 helper 在 `scripts/_shared.mjs`）+ `lib/types.ts` 接口（两套类型系统都要改）。daily.mjs 整体重写 latest.json 会保留已并入对象的新字段。
- **缓存并发安全**：写用 `lib/data.ts` 的 `atomicWrite`（tmp+rename）；读-改-写 JSON 需模块级 `mutex: Promise<void>` 链（见 `lib/find-cache.ts`/`lib/usage.ts`）。
- **AI**：一律 `lib/deepseek.ts` `completeChat(messages, {signal: AbortSignal.timeout(...), reasoningEffort:'low', temperature})`（自动计入用量）；入口 `hasDeepSeekKey()` 门控，503 友好文案；配置走 `lib/ai-config.ts` `resolveAiConfig()`（lib 里绝不读 process.env）。
- **缓存 key 语义**：`undefined`=未知（不触发 chip / 别给 AI 当"无许可"），`null`=确无（触发黄"无许可"/该出现的信号）。搜索项映射时把 `undefined` 透传，别误造假红标。
- **AI 默认不自动调用（token 可控）**：凡页面上会"进页面就生成"的 AI，一律走 **`?peek=1` 探测**——先只查缓存，命中即显；未命中只给「生成」按钮，点按才真正调 AI（结果落缓存）。已按此改造详情页 AI 判读/评测/同类（`/api/{verdict,review,similar}?peek=1`，组件 `AiVerdict/AiReview/SimilarProjects`）。新加 AI 入口照此办理。
- **错误 shape**：`{ error: 中文 }` + status（404/503/502）；客户端读 `j.error`。所有 AI 路由 `export const dynamic="force-dynamic"; export const runtime="nodejs";`。
- **UI**：GitHub 暗色 token（bg `#0d1117/#161b22/#21262d/#30363d`，文字 `#e6edf3/#8b949e`，链接 `#58a6ff`，绿 `#238636/#3fb950`，红 `#f85149`，黄 `#d29922`）。展开用原生 `<details className="group ...">/`<summary marker:text-[#8b949e]">`（无现成 accordion 组件）。
- **README 渲染（components/ReadmeViewer.tsx）**：`rehypeRaw` 渲染原生 HTML + 自写 `rehypeAbsolutize`（相对素材 → `raw.githubusercontent.com/{o}/{n}/HEAD/…`、非 .md 相对链接 → blob）+ `rehypeSanitize` 白名单消毒，**顺序 raw→绝对化→消毒**。仓库内 `.md` 相对链接（README 自带语言/文档切换）→ 页内经 `GET /api/readme?path=` 加载对应文件（`getFileRaw` 走 contents API；data 层 readme 缓存支持子路径 `owner__name__<段>.md`）；其余外链新标签打开。改渲染管线勿动此顺序。
- **AGENTS.md 警告**：此 Next 版本约定与训练数据有出入，写代码前如遇反常先查 `node_modules/next/dist/docs/`。
- **批任务单飞锁（core/jobs/manager.ts）**：各类 AI 长任务共一把跨进程文件锁（`data/cache/gen-job.lock` + 状态 `gen-jobs.json`），互斥不并行、同 kind 同 target 让位、跨 kind 有界排队；kind 现含 digest / weekly / **cross-digest / cross-weekly**（2026-09-11 起后两者独立，勿再借用 digest kind 蹭同日 target）。数据更新中(update-state) 生成请求 409。**持锁必须包心跳**：acquire 成功后 `startLockHeartbeat()`、finishJob 前 `stop()`（锁 mtime >90s 判僵尸回收——热重载/闭包消亡时 pid 判活无效）。凡 AI 批任务入口必须走它，页面轮询 `/api/gen-status` 或对应 peek。详情页「打开即自动」的 AI 在批任务进行中自动回落为点按。
- **AI 周报·自然周口径（2026-09-07）**：周报覆盖**一个自然周（周一~周日）**，**每周一自动整理「上周」**。目标收盘日 = `lastSunday(今天)`，产物 `data/radar/{收盘周日}.md`。web（`lib/weekly.generateWeekReview`、`/api/weekly`、`/radar` 页）与 `daily.mjs` Step 4 同口径；`lib/radar.computeRadar(endDate?)` 支持锚定任意收盘日，不传则仍按最新快照滚动（雷达页）。**冷启动锚点** `lib/weekly-anchor.ts` / `data/config/weekly-anchor.json`：首次开启自动周报（此前未开）从**当周周一起**算、**不回补更早周**，首份完整周在开启当周结束后的下周一生成；关闭自动周报时 `/api/config` 清锚点。手动生成入口（`/radar` 按钮）仅在**周一（周报到期日）**显示，周中不提供，避免“边进行边生成”。改版前的滚动口径历史文件（如 `data/radar/2026-09-03.md`、`2026-09-07.md`）保留为历史、不删除。
- **统一信息流（feed，Phase 4）**：`core/analysis/feed.ts` 只读各源今日快照装配 `FeedItem[]`（中立卡片模型），**各源独立排序、并列分块，度量（★star / pts / 评论数）绝不跨源混比**；`key = "${source}:${source_id}"` 全局唯一；跨源关注走 `data/config/watchlist.json`（`{source,source_id,addedAt}`，复合键去重，`watchlistKey` 判定关注态）。feed **零 AI / 零拉取**（控 token）；GitHub 缓存命中判读信号 `signals` 已由 feed 层预计算，feed 卡直接渲染，勿再对每源重复 computeSignals。**GitHub 板块口径（2026-09-11 起）**：优先 `latest.trending`（Explore 页面抓取、当日新增 star），缺省回落 `new_stars`（近30天新建按总 star）；trending→FeedItem 勿剔 active chip（该剔除仅对新星榜成立）。
- **跨源综述/去重（Phase 5）**：跨源 AI 文本一律走 _源中立文本块_（`core/domain/feed-text.ts` `buildFeedTextBlock`，只给"源内已排序条目 + 各源原生度量"，**不假合并 star/points**，让模型自己跨源判断）；去重/串联用 `core/domain/canonical.ts`（URL 归一优先 + 标题兜底）+ `core/analysis/grouping.ts`（`FeedItem.groupId`）。详情入口分派走 `core/analysis/profile.ts` `itemHrefFor`（勿在组件里写死 isGithub 分支）。跨源产物目录 `data/cross-digests/`（未来源同名同前缀 `weekly-{date}.md` 避开列表正则）；跨源周报生成器放在 `lib/`（依赖 `lib/radar.ts computeRadar`，遵守「core 不 import lib」）。
- **单测统一集中**：所有 `*.test.ts` 放在**顶层 `tests/`**（不散落各模块，2026-09-08 起约定）；vitest `include` 为 `tests/**/*.test.ts`；测试内 import 一律走 `@/core/...` / `@/lib/...` 别名（勿用相对 `./`）。
- **源可插拔（启用源）**：新增/启用某源 = 加一个 `core/sources/{id}/{normalize,adapter}.ts` + 在 `core/sources/registry.ts` 登记 `ALL_SOURCES` + 控制 `data/config/active-sources.json`（默认 `github+juejin+cnblogs`）。`buildFeed` / `cli/run-source` / `cli/daily` 一律**枚举启用源**，勿硬编码源清单；侧边栏与首页源 Tab 由启用源动态生成。**外网源（HN）默认关闭**，需梯子才能拉的源不默认启用。
- **AI 搜索（/find）多路并集**：查询**不"首个非空即停"**——AI 多行英文查询 + 内置中英同义表（`lib/search-synonyms.ts`，兜底）+ **中文原文** 全部搜索并**集去重**（保中文项目、也保 Kodi 这类"描述含 media center"的英文项目）；支持 `sort=popularity`(默认,按 star) 与 `relevance`(按命中路数降序)。勿退回"单候选 + 只搜英文/或只搜中文"。
- **GitHub 热榜（存量榜 /hot）**：类目质量唯一真相源 = `data/config/hot-categories.json` 的 GitHub **查询式**（人可读、git 可 diff；扩展=加配置条目，`id` 稳定当 key）。`queries` 里**勿写 `stars:`**（采集器按 `effectiveStarFloor=max(5000, starFloor)` 运行期附加）。运行期**零 AI**：纯 `searchRepos` 重建 `data/hot/latest.json`（+ history，走 FileStore/atomicWrite，与 trending 快照同构）；`core/sources/github/hot.ts` 复用 `api.ts` 共享客户端。**生成期验证**：改 queries 后 `hot.mjs probe` 看实跑体检报告（入榜 0=过窄提示），满意再 `rebuild`。过滤只有**技术性两条**——`core/domain/hot-filter.ts`（archived/fork/无描述/无 README/star 门槛 硬排除，README 走 `/repos/{o}/{n}/readme` 探测[404=确无则排、其它未知保留]、缓存 `hot-readme.json`；超 1 年未维护**不排除**交 computeSignals 红 chip）。**明确不做关键词/政治敏感审查**（用户指示，词表不落代码；将来另议勿蹭）。展示复用 `FeedCard`（`hotRepoToFeedItem`，保留 active chip，异于新星榜）+ 全站 `watchlist`；分类 tab 横切。中文摘要 `runSummarizeHot`（同一 `summaries.json`，单次上限幂等续跑）。
- **页面性能（2026-09-21 起必守）**：`core/store/file.ts` 的数据读函数已走 `readJsonCached/readTextCached`（mtime+size 版本键，命中零读零 parse）——**新增 data/ 读取一律复用这两个 helper，勿再裸 readFile+JSON.parse**；缓存槽返回**共享对象引用**，凡「先原地改、后写盘」的消费方必须先 `{ ...obj }` 浅拷贝（见 summarize.ts），只读消费方无需拷贝。**全站 force-dynamic 是刻意选择（数据即时性优先），代价是导航无预取——根级 `app/loading.tsx` 不可删除**（删了切页就回到"点击干等整页"）。新增挂在根布局的重组件一律走客户端懒加载边界（参照 `components/FloatingWidgets.tsx`，`dynamic + ssr:false` 必须在 Client Component 内）。
- **决策/对比（M3）**：「项目决策」=确定性（结论规则+事实+风险，每次现算不入库）+AI 四段解释（可缓存带新鲜度）；新详情页 AI 块勿再拆判读/评测。对比篮=localStorage 单真相源（`components/compareStore.ts`），任何页面加「加入对比」用 `CompareButton`；useSyncExternalStore 的 server snapshot 必须返回常量引用。**dev 长时间热重载可能出现客户端 chunk 陈旧（effect 静默不执行零报错）——重启 next dev+清 .next/dev，勿误判代码**。
- **AI 产物来源版本（M0.2 起，新 AI 生成入口必照此）**：所有 AI 产物带 `ArtifactMeta`（`core/domain/artifact.ts`；sidecar 读写在 `core/store/artifact.ts`）——Markdown 主文件零改动、同名 `.md.meta.json` 承载元数据；JSON 产物内嵌 `meta` 字段。`sourceFingerprint` 必须由**实际进入请求的数据**计算（勿只取日期）：引用了 star/增量的正文要么喂量级约数（`coarseBucket`）并把桶放进指纹，要么从提示词移除该指标（判读口径）；池数据类输入可用「今日池 updated_at」入指纹（跨源综述=喂入的 feed-text 块哈希）。读取一律 `readVersionedArtifact`/同前缀回退：精确指纹命中=fresh、有旧版=stale（带旧正文+重新生成入口）、无 meta=legacy，**绝不把 stale 报成未生成**。界面统一七态徽标（`AiCollapseRow`）+ `ArtifactProvenance`（生成于/数据更新于/模型 溯源行 + stale/legacy/failed 提示条）；重新生成失败必须保留旧正文 + genError；auto 只在 missing 触发、stale 不自动烧 token。
- **刷新类后台任务的按钮观感**：凡「POST 起 detached 子进程 + GET 回查 `{running, progress?, lastResult}`」的任务按钮（首页「立即更新」`/api/update`、热榜「重建榜单」`/api/hot`），前端一律走 `components/useBackgroundTask.ts`：① **挂载即回查**——切页离开再回来时恢复运行态与进度条（进度取服务端进度文件，跨进程/重启靠状态文件识别）；② **仅观测到 running→结束 迁移才置 completed**，防止挂载时把今早定时任务的旧 lastResult 误当"刚完成"而刷新页面；③ POST 返回 409（已有任务在跑）→ `begin()` 跟随其进度而非报错。新加同类按钮勿再手写轮询（React 19 lint `set-state-in-effect`：展示派生自 completed，effect 里只放定时器）。AI 批任务（洞察/周报）已有同语义的服务端实现：页面服务端查 `runningJob()` 渲染 `JobRunningNotice` 轮询，切页回来同样恢复。
- **详情页 AI 区块收起**：新增「详情页 AI 懒生成区块」一律用 `components/AiCollapseRow`（一行状态条 + 状态徽标；挂载只 peek 回填状态；body 仅展开时渲染；`usePersistedOpen` 记展开偏好）。**auto 自动生成的语义 = 首次展开时触发**，任何情况下都不在收起状态烧 token。非 GitHub 源的取数走 `core/sources/fetch-retry.ts` `fetchWithRetry`（网络错误/429/5xx 退避重试，其它 4xx 不重试）。
- **更新两段写**：`runUpdateTrending` 会先「快路径」落盘榜单（tracked 沿用上一次）再终写——读侧（feed/详情页）本就要容忍中间态；新加读 latest.json 的逻辑**勿假设单次更新只写一次**，`updated_at` 会先于池数据变新。AI 非流式调用默认带 `disableThinking:true + reasoningEffort:"low"`（端点不认自动降级），别再引入需深度推理的长等待。
- **README/operations 同步**：README 是**门面**（定位/卖点/页面地图/快速开始/配置摘要/开发）；完整运维细节、数据文件清单、Agent 协作口径、FAQ 在 `docs/operations.md`（本仓库数据驱动，该文件是 agent 协作接口）。新增功能后：门面级改动进 README，数据文件/运维口径改动进 operations.md。

---

## 4. 待办路线图（按优先级）

### M — 架构 Phase 1：core 迁移（纯重构，行为零变化）——目标架构见 `docs/architecture.md` §8 Phase 1

> 目标：搭依赖干净的 TS core + 消灭 `.mjs` 镜像；GitHub 现有行为与数据逐文件不变。
> 已拍板（2026-09-07）：A9=esbuild 出 `dist/cli/*.mjs`；A10=eslint `import/no-restricted-paths` 白名单。
> 做法：先留行为基准，**每一步**完成后 `build:cli`/跑 daily 与基准 diff + execution-plan §5 curl 回归全绿才算过；M1 全程不引新数据源、不改首页。
> **2026-09-07 收束**：M1.0–M1.5 ✅（core 骨架 + domain/store/config/jobs/ai/pipeline 迁入与垫片 + vitest，`next build`/`tsc`/`lint`/`test` 全绿）；M1.6/M1.7 经评审**重划并入 Phase 2**（见下两节，原 M1.6 实为半个 Phase 2 的误判）。

#### M1.0–M1.5 ✅ 已落地（2026-09-07；`next build` / `tsc` / `lint` / `test` 全绿）
- [x] **M1.0 行为基准**：`data/baseline-m1/`（latest / history / summaries / radar / digests 快照；未重跑 daily 以免扰动 token 与配额——代码路径未变故基准天然保持）。
- [x] **M1.1 工程搭台**：建 `core/{domain,store,sources,ai,jobs,pipeline,analysis,config}` 骨架（analysis/sources 实现在内）+ `core/index.ts` `createCore` 占位；esbuild `build:cli` 出 `dist/cli/*.mjs`；eslint `import/no-restricted-paths` 挂上守卫；`core/README.md` 落依赖表。
- [x] **M1.2 domain**：中立 `SourceItem/SourceMetric` + 现类型及 `signals/topics/format` 迁 `core/domain/*`；日期纯函数权威模块 `core/domain/calendar.ts`（调用方未搬，按"只抽纯函数"）；`lib/{types,signals,topics,format}.ts` 出垫片。
- [x] **M1.3 store**：`core/store/{file,interface}.ts`（file = 现 `lib/data.ts` 逐字迁入）；`lib/data.ts` 垫片；repository 边界类型立契。
- [x] **M1.4 config/ai/jobs**：`core/config/{ai-config,features,index}.ts`（+keySource）、`core/ai/provider.ts`（AiProvider + deepseek 门面；deepseek 实现仍驻 lib，Phase 2 物理迁入）、`core/jobs/manager.ts`（JobKind 放宽容纳 `source:*`）；`lib/{ai-config,features,jobs}.ts` 垫片。
- [x] **M1.5 pipeline + 单测**：`core/sources/adapter.ts`、`core/pipeline/{run,schedule}.ts`（due 判定 / 失败隔离 / lastRuns 折叠）；引入 vitest，`tests/{calendar,signals,schedule}.test.ts`（13 用例绿；单测已统一集中顶层 `tests/`）。
- 校验注：`scripts/*.mjs` 全程未触碰 → 每日自动化不受影响；M1.2–M1.5 经 `next build` 验证垫片与 core 别名在真实打包下解析成功。

#### M1.6 ✅ 已由 M2 落地（2026-09-07）：薄 CLI + 消灭 .mjs 镜像（原评审判定并入 Phase 2，M2 一并完成）
原计划删 `scripts/_shared.mjs` 及其镜像，前提是 digest/weekly/summarize 生成逻辑与 update-trending 的 fetch/池/快照已在 core 有唯一实现——但 **core/analysis 尚未建立、fetch 仍驻 scripts**，直接删会打断每日自动化。重划为（排入 architecture §8 Phase 2/analysis）：
- 进入 Phase 2 后**先**把 `scripts/update-trending.mjs` 逻辑迁 `core/sources/github`（fetch/池/delta/快照/star 索引），**再**把生成逻辑（summarize/digest/weekly）迁 `core/analysis`（复用已迁 core 的 ai-provider/jobs/config/store），此时才建薄 CLI、删 `_shared.mjs` 与脚本侧镜像、`daily-task.bat` 指向 `dist/cli/daily.mjs`。
- ✅ M2（2026-09-07）已执行：`cli/{run-source,daily}.ts` 成为真实入口，`npm run build:cli` 产出 `dist/cli/{run-source,daily}.mjs`；scripts 镜像删除、web 更新与 daily-task.bat 改指产物。本小节(原 M1.6)视同完成。

#### M1.7 ⏳ 部分完成（2026-09-07）：guard 已挂、收尾已做；完整 zones 待 deepseek/生成器完全入 core 后收紧
- M1.1 已挂 `import/no-restricted-paths`（presentation 不得 import scripts/）跑在 lint、不破坏基线。
- 依 `core/README.md` 依赖表把 zones 收紧成完整白名单 + 故意违例验证 → 并入 Phase 2（core 各层齐了再锁，避免过早过度约束）。
- 收尾（删 `data/baseline-m1/`、回写 architecture.md ADR A2/A11 状态）随 Phase 2 首个迁移落地一并做。

### P0 — 近期收尾
- [x] 提交：由项目负责人择机统一提交（`.gitignore` 已排除 `data/` 与 `.env.local`，示例模板例外入库；切片1/2/雷达/功能设置/批任务单飞锁均在工作区待提交）。
- [x] 实测"无 AI key"降级路径（2026-09-10：备份 `data/config/ai-config.json` → 清空 key → 首页/详情 `/digest`/`/radar` 均 **200**、详情页确定性判读 chips 正常、`/api/find` **无 key 仍返回 40 条**（降级为内置同义表+关键词多路搜索）→ 已恢复 key）。**结论：基础功能无 key 完全可用，AI 功能降级为提示不崩**。遗留小瑕疵已修（2026-09-10）：无 key 时 AI 块（判读/评测/同类/跨源综述）与 `/find` 直接显示「未配置 AI 接入 → 去设置」提示、隐藏生成按钮（新增共用组件 `components/AiUnavailableNotice.tsx`；`hasKey` 由各页 server 端算出并下传组件）。
- [ ] 审阅执行既有工程加固方案 `docs/optimization-plan.md`（多数 F1–F16 已在历次改动中落地，剩余以「执行状态核对」为准；批次 5 待拍板：鉴权/限流/README TTL/digest 彻底后台化/AbortController）。

### P1 — 切片3：趋势雷达 + AI 周报（首个迭代已完成，2026-09-03，见下「未来增量」）
首个迭代已落地并验证：`/radar` 页确定性指标（近 7 日增量 Top / 本周新入视野 / 增速放缓 / 按语言，行内复用判读 chips）由 **`lib/radar.computeRadar()` 直读 `data/history/*.json` 现算**（**绝不读 star-history 浅索引**）；页顶 **AI 周报** 幂等生成存 `data/radar/{date}.md`（目录独立于 digests）；**快照已打底**——`scripts/update-trending.mjs` 历史写手现写 9 字段（原 4 + topics/created_at/pushed_at/archived/license），`lib/types.ts` HistoryEntry 同步（旧文件缺省优雅降级）。
二轮迭代（2026-09-03，全部验证）：① `GENERIC_TOPICS/specificTopics/topicOverlap` 上收 **`lib/topics.ts`**（similar 与雷达共用，停用词单一来源）；② 雷达新增 **「本周主题热度」`RadarData.byTopic`**（带增量仓库按具体话题聚生态热度，如 dsh-plugin +17k）；③ **AI 周报叙事增强**（prompt 增主题热度榜 + 同周单日洞察正文开头），并在 **`scripts/daily.mjs` 加 Step 4 自动周报**（无周报或距上篇 ≥7 天则自动生成；零依赖复刻简化口径、幂等、失败仅告警）；④ 每日快照**冻结当日判读标签 `verdict`**（镜像 signals 保守规则）供"应验"回看。

未来增量（切片3 后续候选）：
- **生态/主题追踪**：按主题把多天趋势串成"这周 DSH 生态怎么演变的"连续叙事（现在 topics 已随快照每日落盘，主题历史从切片3 之后开始可算；更早的 12 天不可回溯）。
- **判断档案（时间壁垒）**：记录"某仓库在何日被标记过什么判读/结论、后来 star/活跃应验没有"。信号已随快照打底（从切片3 起），可基于未来快照做"信号变迁/应验"；历史判定缓存（verdicts/similar）未带日期戳、不可回溯，只能从现在起另行记录。
- **个人向**：本地"我跟踪的主题/仓库"周报。
- ~~周报自动化~~：已落地（daily.mjs Step 4）。2026-09-07 起自动口径改为**自然周**：每周一自动整理「上周（周一~周日）」，首次开启自动时从当周周一起算、不回补更早周（冷启动锚点 `lib/weekly-anchor.ts` / `data/config/weekly-anchor.json`）。
- 判读/同类核心已**历史无关**（即时信号），此切片的"档案"价值是增量而非必需——不阻塞将来的开箱即用公开站。

### P2 — 长期（仅当形态转向公开/更大）
- 中心化公开站：服务端统一抓数攒历史、人人共享雷达；判读核心已是历史无关，冷启动靠"上线前预热 2–4 周"。
- 独立对比页（/compare，多仓并排表格）——`SimilarItem` 已留结构，可渐进做。
- 同类检索的个性化/质量调优（搜索词选择、overlap 阈值、AI 重排）——常量集中在 `similar` 路由 `GENERIC_TOPICS`/`pickSearchTopics` 与 `signals.ts` 阈值。

---

## 5. 现状与验证清单（新会话续作先跑）

现状：dev 常驻 `localhost:3000`；每日 09:00 定时任务跑 `npm run build:cli` 的产物 `node dist/cli/daily.mjs`（数据更新→摘要→洞察→周报自动，AI 周报按**自然周**：每周一整理上周）；数据最新到 2026-09-07。`data/cache/{verdicts,similar,reviews,readme}` 与 `data/cache/{gen-job.lock,gen-jobs.json}` 均为运行时缓存/状态、不入库；`data/config/weekly-anchor.json` 为周报冷启动锚点（无则未开过自动周报）。

验证命令：
```bash
npx tsc --noEmit && npm run lint            # 类型与规范基线
npm run build:cli                            # 构建 CLI 产物（改动 core/cli 后必跑；web「立即更新」与定时器依赖）
node dist/cli/run-source.mjs                 # 手动刷新数据（幂等；latest.json 每仓含 pushed_at/archived/license）
node dist/cli/daily.mjs                      # 每日一键（会保留 latest.json 新增字段）
```
端到端 curl（dev 在 3000）：
```bash
curl 'http://localhost:3000/api/verdict?repo=deepseek-ai/deepseek-harness'   # AI 判读，二次 cached:true
curl 'http://localhost:3000/api/similar?repo=deepseek-ai/deepseek-harness'   # 同类+取舍，二次 cached:true
curl 'http://localhost:3000/repo/deepseek-ai/deepseek-harness'               # 详情页：信息卡 chips + 侧栏 AI 判读/评测 + 同类区块
curl -X POST 'http://localhost:3000/api/find' -H 'Content-Type: application/json' -d '{"query":"desktop pet","source":"all"}'  # find 结果带 pushed_at/archived
curl 'http://localhost:3000/'                                      # 技术热点追踪（聚合首页）：各启用源板块（源码徽标/度量/只看关注）
curl -X POST 'http://localhost:3000/api/watchlist' -H 'Content-Type: application/json' -d '{"source":"github","source_id":"deepseek-ai/deepseek-harness"}'  # 加入关注（二次调用=取消）
curl 'http://localhost:3000/api/cross-digest?peek=1'                  # 跨源综述：未命中 {available:false}，POST 后二次 peek cached:true
curl -X POST 'http://localhost:3000/api/cross-digest'                 # 生成 data/cross-digests/{date}.md
curl 'http://localhost:3000/hn/49593563'                              # HN 本地详情 200；无效 id → 404
```
改动代码后回归三件事：AI 评测（`/api/review`）、`/digest`、新星榜/追踪池列表 chips 无回归；Phase 4 起再加：技术热点追踪（聚合首页）各源板块、`/api/watchlist` 增删往返、`/hn` 与 `/repo/{name}` 200；Phase 5 再加：`/api/cross-digest` peek/POST、`/hn/{id}` 404、综述块「今日跨源值得看」。

---

## 6. 文件速查（判读/同类相关）

新增：`lib/signals.ts`、`components/VerdictChips.tsx`、`app/api/verdict/route.ts`、`components/AiInsight.tsx`（判读/评测共用，导出 AiVerdict/AiReview）、`app/api/similar/route.ts`、`components/SimilarProjects.tsx`。
修改：`lib/types.ts`、`scripts/update-trending.mjs`、`components/{FindStore,RepoRow,TrackedTrend,ProjectFinder}.tsx`、`lib/find-cache.ts`、`app/api/find/route.ts`、`app/repo/[owner]/[name]/page.tsx`、`README.md`、`docs/`（本文档）。
镜像模板：`app/api/review/route.ts`、`components/AiInsight.tsx`（旧 `components/{AiVerdict,AiReview}.tsx` 已合并删除）。

后续增量（功能设置·开关 + 批任务单飞锁）文件见上文两小节：
新增 `lib/features.ts`、`lib/jobs.ts`、`app/api/gen-status/route.ts`、`components/JobRunningNotice.tsx`；`app/api/{config,digest,weekly}/route.ts`、`app/{settings,digest,radar}/page.tsx`、`app/repo/[owner]/[name]/page.tsx`、`scripts/{_shared.mjs,daily.mjs}` 修改。

Phase 4（统一信息流首页）文件见上文「统一信息流首页」小节：
新增 `core/analysis/feed.ts`、`app/api/watchlist/route.ts`、`components/{FeedCard,FeedBoard}.tsx`、`core/analysis/feed.test.ts`；`core/{domain/types,store/file}.ts`、`app/page.tsx`、`components/Sidebar.tsx`、`app/layout.tsx`、`README.md`、`docs/architecture.md` 修改。

Phase 5（深潜与跨源叙事）文件见上文「深潜与跨源叙事（Phase 5）」小节：
新增 `core/domain/{feed-text,canonical}.ts`（+各自 test）、`core/analysis/{grouping,cross-digest,profile}.ts`（+grouping.test）、`lib/cross-weekly.ts`、`app/api/cross-digest/route.ts`、`app/hn/[id]/page.tsx`、`components/FeedSummary.tsx`；修改 `core/{domain/types,store/file}.ts`、`core/sources/hackernews/adapter.ts`、`core/config/features.ts`、`app/{settings/page,page}.tsx`、`components/{FeedCard,FeedBoard}.tsx`、`app/hn/page.tsx`、`cli/daily.ts`、`README.md`、`docs/{architecture,execution-plan}.md`。
