# 运维与数据参考

> 从 README 移出的完整运维细节（README 只做门面）。**新增功能/数据文件后：门面改动进 README，数据文件/运维口径改动进本文**（本仓库数据驱动，本文是 agent 协作接口）。

## 数据更新

### 网页一键更新（推荐）
首页顶栏「立即更新」：后台执行刷新**全部启用源**，立即返回不阻塞；按钮显示状态，完成短暂提示（成功 / 部分配额不足 / 失败）。更新中重复点击会被拦截（409）。**切页不中断**：更新在独立后台进程继续跑，离开首页再回来，按钮自动恢复运行态、进度条与服务端真实进度一致（任务态落盘 `data/cache/update-state.json`，进程重启也能识别）。热榜「重建榜单」同款行为。

### 命令行
```bash
npm run build:cli                        # 改动 core/cli 后必须重跑，产出 dist/cli/*.mjs
node dist/cli/run-source.mjs             # 等价 all：刷新全部启用源
node dist/cli/run-source.mjs all         # 同上（显式）
node dist/cli/run-source.mjs github      # 只刷 GitHub（保留退出码语义）
node dist/cli/run-source.mjs juejin      # 只刷掘金
node dist/cli/run-source.mjs cnblogs     # 只刷博客园
node dist/cli/daily.mjs                  # 每日一键：刷新源 → 热榜重建 → 中文摘要 → 每日洞察 → 周报 → 跨源综述
node dist/cli/daily.mjs --force          # 强制重生成当日洞察
node dist/cli/hot.mjs probe              # GitHub 热榜：对当前查询式实跑体检 → 报告（不改数据）
node dist/cli/hot.mjs rebuild            # GitHub 热榜：全量重建快照（纯 searchRepos、零 AI）
node dist/cli/hot.mjs summarize          # GitHub 热榜：中文摘要增量补全（需 key，单次有上限、幂等可续跑）
```

**退出码**：`0` 全成功 / `1` 有源失败 / `2` 有源限流部分成功（已保存部分，下次补齐）。

### 定时任务（Windows 任务计划程序）
入口脚本 `scripts/daily-task.bat`（调 `dist/cli/daily.mjs`，日志追加到 `data/logs/daily.log`）**是机器专用文件、刻意不入库**（内含本机绝对路径），每台机器自建一份。建任务（管理员）：
```
schtasks /Create /TN "技术信息聚合站每日更新" /TR "<仓库路径>\scripts\daily-task.bat" /SC DAILY /ST 09:00 /F
```
仅**开机时段**触发；错过可手动 `node dist/cli/daily.mjs`（幂等）。日志：`data/logs/daily.log`。

### 刷新耗时与瓶颈
GitHub 约 60+ 次 REST（2 次搜索 + 追踪池详情 + 趋势榜富化 ≤25 次），受 **匿名 60 次/小时**限流；**配 GitHub Token 是最大提升**（5000/小时）。已做的提速与加固：
- **快路径两段写**：搜索 + 趋势榜页面完成后（实测 ~20s）**先把榜单落盘** latest.json（追踪池沿用上次），首页立刻可见新数据；池详情与富化跑完再全量终写（含 delta/判读字段）。
- **各源并发**：`run-source all` / 网页「立即更新」里 GitHub 与掘金/博客园**同时开跑**，墙钟取最长源（实测全链 ~30s）。
- **瞬时失败自动恢复**：GitHub 走重试/退避；掘金/博客园 HTTP 走 `fetchWithRetry`（网络错误与 429/5xx 退避重试 2 次）；另抓 1 次 `github.com/trending` 页面（**不占 API 配额**；本机直连常被重置，代码自动回退代理——优先 `GITHUB_TRENDING_PROXY`/`HTTPS_PROXY` 环境变量，再探测本地 `127.0.0.1:7897`；全失败则 latest 无 `trending` 字段，feed 回落新星榜口径，不阻塞更新）。
- **AI 生成提速**：判读/评测/同类/决策/跨源综述统一 `disableThinking`（Qwen3/vLLM 兼容端点 `enable_thinking:false`，本机网关实测约快一倍；端点不认自动降级 `reasoning_effort`）。

## 数据文件（`data/`，**不入 git**）

| 文件 / 目录 | 内容 |
|---|---|
| `data/latest.json` | GitHub 当日聚合（**Explore 趋势榜 trending** + 新星榜 + 追踪池 + 更新时间 + 判读信号），GitHub 板块/详情页数据源 |
| `data/sources/{juejin,cnblogs}/latest.json` | 掘金 / 博客园内容流快照（对应板块数据源；`SourceItem` + 各自原生度量）|
| `data/sources/{source}/history/{date}.json` | 各源每日快照（HN 等；趋势用）|
| `data/history/{YYYY-MM-DD}.json` | GitHub 每日追踪池快照（delta/star 趋势 + 信号 + 冻结判读标签）|
| `data/digests/{YYYY-MM-DD}.md` | 每日洞察文章（手动放入的 .md 同样展示）|
| `data/radar/{YYYY-MM-DD}.md` | AI 趋势周报（自然周收盘日）|
| `data/cross-digests/{date}.md` | 跨源「今日值得看」AI 综述产物（`weekly-{date}.md` 为跨源周报）|
| `data/hot/latest.json` · `data/hot/history/{date}.json` | GitHub 热榜存量快照（分类条目 + 出榜记录；`/hot` 数据源）|
| `data/hot/probe-report-{date}.md` | 热榜查询式实跑体检报告（`hot.mjs probe` 生成，供调 `queries`）|
| `data/config/hot-categories.json` | 热榜类目查询式（`{id,label,queries[],starFloor}`；`.example` 入库）|
| `data/config/active-sources.json` | 启用源清单（设置页「数据源」卡直接启停，无需编辑 JSON）|
| `data/config/preferences.json` | 兴趣偏好（语言/主题/不感兴趣主题/新旧偏向；**仅影响「今日必须看」加权**，且进入简报指纹——改偏好即标 stale 可重建）|
| `data/config/watchlist.json` | 跨源关注清单（`{source,source_id,addedAt}`；可带 `snapshot`（标题/URL/最后度量/捕获时刻）与 `note`，旧记录照常读取）|
| `data/config/{ai-config,features,weekly-anchor}.json` | AI 接入 / 功能开关（`autoDailyInsight/autoWeeklyReport/autoDecision/autoSimilar/autoCrossDigest/autoBriefing`）/ 周报冷启动锚点 |
| `data/config/tracked-repos.json` | GitHub 追踪池仓库全名列表（**关注仓库参与每日采样但不写入此文件**；取消关注不触碰它）|
| `data/cache/` | `summaries.json`（中文摘要）、`readme/`（README 缓存）、`hot-readme.json`（热榜 README 探测）、`verdicts/`·`reviews/`（兼容接口缓存）、`similar/`、`decisions/`（项目决策 AI 解释）、`briefing/{date}.json`（今日简报：选择结果+推荐语+指纹）、`gen-jobs.json`（批任务单飞状态）、`update-state.json`、`hot-state.json`（热榜重建任务态）|
| `*.meta.json` sidecar | 与 md 产物同名旁挂（如 `cross-digests/*.md.meta.json`、`digests/*.md.meta.json`）：`generatedAt/sourceDate/sourceUpdatedAt/sourceFingerprint/model`——AI 产物的来源版本，缺 sidecar=历史缓存（legacy）|
| `data/logs/` | `update-trending.log`（网页更新）、`hot.log`（热榜重建）、`daily.log`（定时任务）|

## 目录结构

```
app/                              # Next.js 呈现壳（服务端直读 data；路由只做 glue）
├── page.tsx                      # 首页：今日必须看简报(含跨源综述并入) + 异常变化 + 统一信息流 + 立即更新
├── hot/                          # GitHub 热榜存量榜（分类 Tab / 只看关注 / 出榜理由 / 重建）
├── find/                         # AI 智能寻找（示例直搜、筛选、为什么匹配）
├── watch/                        # 关注中心（live·离榜快照·待采样·历史关注五态）
├── compare/                      # 项目对比（本地对比篮事实矩阵 + 可选 AI 场景建议）
├── repo/[owner]/[name]/          # 仓库详情：判读 chips / star 趋势 / 项目决策卡 / 同类 / README
├── digest/ · radar/              # 每日洞察 · 趋势雷达+AI 周报
├── hn/ · hn/[id]/                # Hacker News（外网源，默认关闭）
├── settings/                     # 设置：AI 接入 / 功能开关 / 数据源 / 兴趣偏好（两列栈）
├── loading.tsx                   # 根级骨架（force-dynamic 下导航预取的锚，勿删）
└── api/                          # briefing/decision/similar/verdict*/review*/similar · compare/find
                                  # cross-digest/digest/weekly/gen-status · update/hot/config/usage
                                  # watchlist/sources/preferences · chat/translate/readme（* = 兼容保留）
components/                       # FeedBoard/FeedCard/FeedSummary、BriefingSection、WatchBoard/HotBoard、
                                  # ProjectDecision/CompareBoard/CompareButton/CompareTray/compareStore、
                                  # AiCollapseRow/SimilarProjects/ArtifactProvenance/VerdictChips、
                                  # RadarTopPanel/Sparkline/DigestMarkdown/RepoActionList、
                                  # FindStore/ProjectFinder、ChatWidget/TranslateWidget/FloatingWidgets(懒加载边界)、
                                  # Sidebar/UpdateButton/useBackgroundTask…
core/                             # ★ 业务引擎（零 Next import，web 与 CLI 共用）
├── domain/                       # 纯函数：types/signals/topics/calendar/artifact/decision/repo-refs/
│                                 #   find-explain/feed-text/canonical/hot-filter…
├── store/                        # file.ts（原子写 + mtime 版本键缓存 + watchlist）· artifact.ts（meta sidecar）
├── ai/                           # provider 门面（委托 lib/deepseek）
├── jobs/                         # 跨进程批任务单飞锁（kind：digest/weekly/cross-digest/cross-weekly + 心跳）
├── pipeline/                     # run 编排 + schedule 调度判定
├── sources/                      # adapter 契约 + registry + github(updater/trending/api/hot)/juejin/cnblogs/hackernews + fetch-retry
├── config/                       # features/ai-config/env/weekly-anchor/active-sources/hot-categories/preferences
└── analysis/                     # feed/briefing/anomalies/grouping/cross-digest/summarize/hot-probe/profile
lib/                              # 兼容垫片 + 生成器(digest/weekly/radar/decision/cross-weekly/deepseek/find-cache…) + github API
cli/                              # 薄入口：run-source.ts / daily.ts / hot.ts → esbuild → dist/cli/*.mjs
scripts/                          # cli-build.mjs（esbuild 构建）；daily-task.bat 为机器本地文件（未入库）
tests/                            # 全部单测（vitest，统一集中于此）
docs/                             # 本文（运维）/ architecture.md（目标）/ execution-plan.md（现状·待办）/
                                  # product-optimization-plan.md（M0-M5 规格）/ optimization-plan.md（工程加固）
data/                             # ★ 全部内容来源（不入库；仅 data/config/*.example 模板入库）
```

## Agent 协作（内容由 data/ 驱动，脚本 + 数据文件即可管理）

| 用户对 agent 说 | agent 执行 |
|---|---|
| 「更新数据」 | `npm run build:cli && node dist/cli/run-source.mjs all`，汇报变化 |
| 「分析本周 AI 方向趋势」 | 读 `data/history/*.json`，写 Markdown 存 `data/digests/{date}-ai-weekly.md`（自动出现在 /digest）|
| 「把 xxx/yyy 加入追踪池」 | 编辑 `data/config/tracked-repos.json` 加入 `"xxx/yyy"`，次日生效 |
| 「重建/刷新热榜」 | `node dist/cli/hot.mjs rebuild`（零 AI，或点 `/hot` 右上「重建榜单」），汇报入榜/出榜数 |
| 「调整热榜类目质量」 | 编辑 `data/config/hot-categories.json` 的 `queries` → `node dist/cli/hot.mjs probe` 看体检报告 → 满意后 `rebuild` 落榜 |
| 「调整兴趣偏好」 | 设置页「兴趣偏好」卡，或写 `data/config/preferences.json`（只影响简报加权；改后简报标 stale 可重建）|
| 「换/加一个信息源」 | 加 adapter + `registry.ts` 登记 + `active-sources.json`（见 README「配置」）|
| 「调整榜单/改版首页」 | 正常改代码 |

## 已知行为 / FAQ

- **匿名 GitHub API 60 次/小时**：追踪池上限约 60 仓；配额耗尽脚本以退出码 2 优雅退出，已拉部分保留，下次续跑补齐。配 Token 后大幅缓解。
- **GitHub 语言 Tab**（总榜/Python/JS·TS/Rust/AI）在前端按 `language` + `topics/description` 过滤，不额外耗 API 配额。
- **README** 按需懒加载并写磁盘缓存（同一仓库只抓一次）。
- **AI 默认不自动**：凡「进页面就生成」的 AI 一律先查缓存（peek），未命中给「生成」按钮；详情页区块（决策/同类）与首页综述/简报均为**一行收起态**——即使开了自动开关，token 也只在首次展开时消耗。旧 `/api/{verdict,review}` 路由保留为兼容接口（无页面引用）。
- **批任务不打架**：洞察/周报/跨源综述（kind：digest / weekly / cross-digest / cross-weekly）共用跨进程单飞锁，持锁期锁文件带 5s 心跳（过期 90s 判僵尸可回收——防 dev 热重载杀后台闭包留死锁）；数据更新中生成请求 409；页面轮询「正在生成」自动刷新。
- **首页/详情每次请求读最新数据文件**，更新后无需重启即见。
- **页面切换性能设计**：全站 force-dynamic（数据即时性优先）→ 根级 `app/loading.tsx` 让 Link 预取+骨架秒切；`core/store/file.ts` mtime+size 版本键缓存消除重复读盘解析（⚠️ 缓存槽返回共享对象引用，「先改后写」的消费方必须浅拷贝）；挂根布局的重组件走客户端懒加载边界（`FloatingWidgets`，`dynamic + ssr:false` 必须在 Client Component 内）。
- **dev 左下角无编译指示器**：`next.config.ts` 设了 `devIndicators:false`（常驻转圈易被误读为"页面在加载"）；编译/运行错误仍会弹出。
