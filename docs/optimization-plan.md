# GitHub Trending 优化方案

> 状态:**大部分已在后续开发中落地**，本文保留为逐项方案与「执行状态核对」，见下表。批次 5 默认未做，仍待拍板。
> 日期:2026-09-02（方案初稿）· 2026-09-07（按当前代码核对）
> 前置基线:`npx tsc --noEmit` 与 `npm run lint` 均通过。

## 执行状态核对（2026-09-07，按当前代码逐项核实）

| 项 | 状态 | 核实依据 |
|---|---|---|
| F1 原子写 + 互斥 | ✅ 已落地 | `lib/data.ts atomicWrite`；`lib/usage.ts` / `lib/find-cache.ts` 模块级串行写；`scripts/update-trending.mjs` 6 处 `atomicWrite` |
| F2 429 等待上限 | ✅ 已落地 | `update-trending.mjs:413-415` `wait = Math.min(Math.max(retryAfter||…,30),120)` |
| F3 共享 remaining 竞态 | ✅ 已落地 | `update-trending.mjs:401-403` 改用本次请求 `r.remaining`，共享仅作报告 |
| F4 SSE CRLF + 尾部 flush | ✅ 已落地 | `lib/deepseek.ts` `split(/\r?\n\r?\n/)` + 流结束 flush 残留 |
| F5 更新状态落盘 | ✅ 已落地 | `app/api/update/route.ts` 读写 `data/cache/update-state.json` + pid 存活探测 |
| F6 reasoning_effort 400 降级 | ✅ 已落地 | `lib/deepseek.ts` 400 且带 reasoning_effort 时去掉重试一次 |
| F7 star 历史索引 | ✅ 已落地 | `lib/data.ts` 索引读写 + `rebuildStarHistoryIndex`；repo 页读索引、旧了懒重建 |
| F11 提示词/数据块去重 | ✅ 已落地 | `lib/prompt-blocks.ts`，`lib/deepseek.ts` 与 `lib/digest.ts` 复用 |
| F14 删 `newStarsQuery` 死代码 | ✅ 已落地 | `lib/github.ts` 已无该函数 |
| F15 keySource 由服务端返回 | ✅ 已落地 | `app/api/config/route.ts` 返回真实来源，设置页直接采用 |
| F16 杂项（format/_shared/移动端门控） | ✅ 已落地 | `lib/format.ts`、`scripts/_shared.mjs`、`UsageBadge` 用 `matchMedia(≥768px)` 门控轮询 |
| F8 config 无鉴权 / SSRF 面 | ⏸ 未做（待拍板） | 仅应监听本机（127.0.0.1）；暴露局域网/公网前需加 |
| F9 AI 接口无限流 | ⏸ 未做（待拍板） | 单人本地自用可不做 |
| F10 README/评测缓存无 TTL | ⏸ 未做 | README 永久缓存；评测按仓库名缓存——若要时效再加 |
| F12 digest 彻底后台化 | 🔶 部分 | 已加批任务单飞锁 + 页面「生成中」轮询（不会重复/丢）；但请求仍是同步长连接，非 detached 子进程 |
| F13 流式可取消(AbortController) | ⏸ 未做 | 关聊天/翻译面板后请求仍跑完，token 照计 |

> 结论：批次 1–4 除遗留核对外的既定项均已落地且通过 tsc/lint，**无需重做**；后续只处理批次 5（按需勾选）或上表 ⏸ 项。

---

## 0. 总体策略

| 批次 | 内容 | 风险 | 验证方式 |
|---|---|---|---|
| **批次 1 数据安全**(F1/F2/F4) | 原子写、429 等待上限、SSE 解析健壮性 | 低,纯增量 | 跑真实数据 + 手动聊天 |
| **批次 2 更新任务健壮性**(F3/F5) | 并发竞态、状态落盘 | 中,涉脚本并发 | 连跑两次更新脚本对拍 |
| **批次 3 详情页性能**(F7) | star 历史索引 | 中,新增索引文件 | 对比改动前后详情页耗时 |
| **批次 4 兼容与提示词**(F6/F11/F14/F15/F16) | reasoning_effort 重试、提示词去重、死代码、UI 小修 | 低 | lint + 手动 |
| **批次 5 可选/待拍板**(F8/F9/F10/F12/F13) | 鉴权、限流、缓存 TTL、digest 后台化、流式可取消 | 中 | 按需验证 |

执行顺序建议:**批次 1 → 2 → 3**,各批次完成后跑一次 `npm run build` 回归;批次 4/5 视你的反馈。

---

## 批次 1 数据安全

### F1. 所有 JSON 写入改为原子写

**问题**:`lib/data.ts` 的 `writeLatest` / `writeHistory` 用 `fs.writeFile` 直接覆盖。更新脚本在后台进程写 `latest.json` 的同时,浏览器请求首页正在 `readFile`——可能读到截断/空 JSON,`JSON.parse` 失败,首页短暂显示"暂无数据"。`lib/usage.ts` / `lib/find-cache.ts` 的"读-改-写"三步并发时会**丢计数/丢缓存更新**。

**方案**:

```ts
// lib/data.ts 新增
async function atomicWrite(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data, 'utf-8');
  await fs.rename(tmp, file); // 同目录 rename 原子替换
}
```

- `lib/data.ts`:`writeLatest` / `writeHistory` / `writeTrackedRepos` / `writeSummaries` / `writeReadmeCache` 全部改走 `atomicWrite`。
- `lib/usage.ts` `addAiUsage`:读-改-写加**进程内互斥**(模块级 `let lock = Promise.resolve()`,串行化),并原子写。
- `lib/find-cache.ts` 同法。
- `scripts/update-trending.mjs`(零依赖):复制一份同样的 `atomicWrite`,用于 `POOL_FILE` / `LATEST_FILE` / `HISTORY_FILE` / `PROGRESS_FILE`。

**涉及文件**:`lib/data.ts`、`lib/usage.ts`、`lib/find-cache.ts`、`scripts/update-trending.mjs`

**验证**:后台触发更新,同时连续刷新首页 20 次,确认不再出现"暂无数据"闪烁;连续并发两次 AI 调用后检查 `ai-usage.json` 计数正确。

---

### F2. 更新脚本 429 等待时长加上限

**问题**:`scripts/update-trending.mjs:415`

```js
const wait = Math.max(r.retryAfter || RETRY_WAIT_MS / 1000, 30);
await sleep(wait * 1000);
```

GitHub `retry-after` 头可能返回 3600(秒),脚本会 `sleep` 一小时,每日定时任务被挂死。

**方案**:`const wait = Math.min(Math.max(r.retryAfter || 60, 30), 120);`(上限 120s,超限仍失败则跳过该仓库,不中断整个更新)。

**涉及文件**:`scripts/update-trending.mjs`

**验证**:模拟 `retryAfter: "3600"` 的 429 响应,确认等待被钳到 120s 内。

---

### F4. SSE 流解析健壮性(CRLF + 尾部残留)

**问题**:`lib/deepseek.ts:101-126`

1. 只用 `\n\n` 切分事件。上游若用 CRLF(`\r\n\r\n`)结束事件,事件永远切不开,`[DONE]` 识别不到。
2. `reader.read()` 返回 `done` 时,残留在 buffer 里的最后一个 `data:` 行(无尾部空行)被丢弃——**最后一段 delta 可能丢失**。

**方案**:

```ts
// 切分改为兼容 CRLF
const events = buffer.split(/\r?\n\r?\n/);
buffer = events.pop() ?? "";
// 在 reader done 分支:先 flush 残留 buffer 再 close
```

**涉及文件**:`lib/deepseek.ts`

**验证**:用 CRLF 换行的 SSE 假流跑 `chatStream`,确认事件完整、结尾不丢字;真实聊天确认无回归。

---

## 批次 2 更新任务健壮性

### F3. 并发拉取共享 `remaining` 竞态

**问题**:`scripts/update-trending.mjs:375,404,444`。`concurrency = 6` 的 worker 共享同一个 `remaining`,每次请求覆写它;底部 `if (remaining < CORE_STOP) stopped = true` 读到的是"最后一次赋值",一个慢请求可能让整池过早全局停止,或两个请求同时冲限流。

**方案**:`fetchRepo` 内改用**本次请求自己的** remaining 做停止判断(`const rem = r.remaining`),共享 `remaining` 仅保留给最终报告;`stopped` 仍是共享标记(已有)。

**涉及文件**:`scripts/update-trending.mjs`

**验证**:低配额下跑更新,确认不会因单请求乱序而过早停止;正常配额下结果与改动前一致。

---

### F5. 更新任务状态落盘(进程重启不失真)

**问题**:`app/api/update/route.ts:13-14` 用模块级 `running` / `lastResult`。进程(dev server / 生产)重启后,已 detached 的子进程仍在跑,但 `running` 复位为 `false`——此时再点更新会**并发跑两个更新脚本**,互相覆盖 `latest.json`。

**方案**:状态落盘到 `data/cache/update-state.json`:

```jsonc
{ "pid": 1234, "startedAt": "...", "code": null, "message": null, "finishedAt": null }
```

- `POST`:读盘,若 `pid` 存活(`process.kill(pid, 0)` 探测)返回 409;否则写盘 pid 后 spawn。
- 子进程 `close` / `error` 时回写 `code` / `message` / `finishedAt`。
- `GET`:改读该文件(模块变量只作内存缓存)。

**涉及文件**:`app/api/update/route.ts`、`scripts/update-trending.mjs`(无改动,仅状态消费者)

**验证**:更新进行中重启 dev server → 再点更新应仍 409;结束后状态可读。

---

## 批次 3 详情页性能

### F7. star 趋势历史改为索引读,不再全量扫快照

**问题**:`app/repo/[owner]/[name]/page.tsx:77-84` 每次进详情页都 `listHistoryDates()` + 对**每一天** `readHistory()`(读文件 + 解析整个快照)。运行一年 = 365 次文件读/请求,且页面是 `force-dynamic`。

**方案**:更新脚本维护 `data/cache/star-history.json`,结构:

```jsonc
{ "facebook/react": [ { "date": "2026-09-01", "stars": 120000 }, ... ], ... }
```

- `scripts/update-trending.mjs` 在写当日 history 快照的同时,把当日各池仓库的 `{date, stars}` upsert 进索引。
- 详情页改为读索引、按 `full_name` 取序列;索引缺失/旧于最新 history 日期时**懒重建**(一次,兜底)。

**涉及文件**:`scripts/update-trending.mjs`、`lib/data.ts`(读索引函数)、`app/repo/[owner]/[name]/page.tsx`

**验证**:压测 100+ 天历史下详情页渲染耗时(改动前 ~100ms+ → 期望 <10ms);趋势图数据与改动前逐点一致。

---

## 批次 4 兼容与提示词

### F6. `reasoning_effort` 不兼容时降级重试

**问题**:`lib/deepseek.ts:68,155`、`lib/digest.ts:69`、`app/api/find/route.ts:102,156`。`reasoning_effort` 是 OpenAI reasoning 系参数;部分中转站/严格网关对未知字段直接 400,聊天/翻译/摘要整体不可用,且错误文案误导。

**方案**:`chatStream` 与 `completeChat` 捕获 400 且 body 带 `reasoning_effort` 时,去掉该参数**重试一次**;仍失败才抛 502。另把错误文案改为"接口拒绝参数 reasoning_effort,已尝试降级"。

**涉及文件**:`lib/deepseek.ts`(统一处理,digest/find 复用)

**验证**:指向一个会 400 未知字段的假端点,确认重试后成功;真实 DeepSeek 无回归。

---

### F11. 提示词与数据块构建去重

**问题**:`lib/deepseek.ts:15-44`、`lib/digest.ts:36-65`、`scripts/daily.mjs:202-228` 的新星榜文本 / delta Top / 洞察标题构建逻辑几乎一致(脚本因零依赖不能引 lib)。

**方案**:服务端把 `buildNewStarsBlock()` / `buildDeltaBlock()` 抽到共享工具(如 `lib/prompt-blocks.ts`),`deepseek.ts` 与 `digest.ts` 复用;`daily.mjs` 保持自包含,但加注释"与 lib/prompt-blocks.ts 保持同步"。

**涉及文件**:`lib/deepseek.ts`、`lib/digest.ts`、新增 `lib/prompt-blocks.ts`、`scripts/daily.mjs`(仅注释)

**验证**:`npm run build` + 生成一次洞察,输出与改动前一致。

---

### F14. 删除死代码 `newStarsQuery`

**问题**:`lib/github.ts:74-79` 全库无调用;且用 `toISOString()`(UTC),与脚本的 `localDateStr`(本地时区)不一致,留作隐患。

**方案**:直接删除该函数。

**涉及文件**:`lib/github.ts`

**验证**:`tsc --noEmit` 通过。

---

### F15. 设置页 `keySource` 恒写死 "website"

**问题**:`app/settings/page.tsx:88` `keySource: action === "clearKey" ? "none" : "website"`。若 key 实际来自 `.env.local`,随便点一次"保存配置"后界面误显示"来源:网站设置"。

**方案**:由 `POST /api/config` 响应返回真实 `keySource`(服务端本就能算),前端直接采用。

**涉及文件**:`app/settings/page.tsx`、`app/api/config/route.ts`

**验证**:env 提供 key 时点保存,界面仍显示".env.local"。

---

### F16. 杂项小修

- **`components/RepoRow.tsx:6` 与 `components/ProjectFinder.tsx:18` 的 `formatStars` 统一**到一个 util(`lib/format.ts`),行为以现有调用方为准。
- **`components/UsageBadge.tsx:27` 移动端仍轮询**:用 `matchMedia('(min-width: 768px)')` 门控轮询与 visibilitychange。
- **`scripts/update-trending.mjs` 与 `scripts/daily.mjs` 的 `loadEnv` / `localDateStr` / `readJson` 重复**:抽 `scripts/_shared.mjs`(零依赖,两脚本 import)。

**涉及文件**:`components/RepoRow.tsx`、`components/ProjectFinder.tsx`、新增 `lib/format.ts`、`components/UsageBadge.tsx`、`scripts/update-trending.mjs`、`scripts/daily.mjs`、新增 `scripts/_shared.mjs`

**验证**:`lint` + 手动回归首页/寻找页。

---

## 批次 5 可选 / 待你拍板

| 项 | 内容 | 结论需要 |
|---|---|---|
| **F8** | `/api/config` 无鉴权 + baseUrl 可改(SSRF 面) | 是否可能暴露到局域网/公网?是 → 加简单鉴权或仅监听 127.0.0.1;否 → 不改 |
| **F9** | 聊天/翻译/摘要等 AI 接口无速率限制 | 是否多人/公网使用?是 → 加内存限流;否 → 不改 |
| **F10** | README / AI 评测缓存永不过期 | 是否需要内容时效?是 → 加 TTL(README 7 天) |
| **F12** | `/api/digest` 120s 同步长请求,超时即丢结果 | 是否改后台任务 + 轮询(复用 update 模式)?改动量中 |
| **F13** | 聊天/翻译流无 `AbortController`,关面板后请求仍跑 | 是否要"关闭即取消"?改动量小 |

> 这五项默认**不进入本次执行范围**,除非你明确勾选。

---

## 改动文件总览

```
新增:
  docs/optimization-plan.md           本方案
  lib/prompt-blocks.ts                批次4 共享提示词块(可合并入 F11)
  lib/format.ts                       批次4 star 格式化统一(可合并入 F16)
  scripts/_shared.mjs                 批次4 脚本公共函数(可合并入 F16)

修改:
  lib/data.ts                         批次1 原子写 + 批次3 索引读取
  lib/usage.ts                        批次1 原子写 + 互斥
  lib/find-cache.ts                   批次1 原子写 + 互斥
  lib/deepseek.ts                     批次1 SSE 解析 + 批次4 reasoning 降级
  lib/github.ts                       批次4 删死代码
  lib/digest.ts                       批次4 复用提示词块
  scripts/update-trending.mjs         批次1 原子写/429上限 + 批次2 竞态 + 批次3 索引写入
  scripts/daily.mjs                   批次4 抽公共函数(注释同步)
  app/api/update/route.ts             批次2 状态落盘
  app/repo/[owner]/[name]/page.tsx    批次3 索引读取
  app/api/config/route.ts             批次4 返回真实 keySource
  app/settings/page.tsx               批次4 keySource 修复
  components/RepoRow.tsx              批次4 格式化统一
  components/ProjectFinder.tsx        批次4 格式化统一
  components/UsageBadge.tsx           批次4 移动端门控

未涉及(不进本次范围):
  README.md、app/globals.css、eslint.config.mjs、next.config.ts、tsconfig.json、
  data/*(全部为运行期数据,不入库)
```

---

## 复盘发现（设计与实现对照，2026-09-09 归档，原 docs/optimization-notes.md）

> 用途：基于设计文档（architecture/execution-plan/multisource-design）与真实代码逐项对照，记录**客观存在的设计不足**（两档：客观缺陷 / 待拍板风险）。区别于上文 F1–F16（既定加固方案）：本表记"设计声称 X、代码是 Y"的缺口与处置优先级。**下方大部分属 M1.7+ 遗留与后续 Phase，非"坏了"而是"声明的目标未兑现"。**

### A. 客观缺陷（设计已声明，实现缺失/不符）

| 编号 | 缺口 | 一句话影响 | 严重度 |
|---|---|---|---|
| 缺陷-1 | `createCore` 组合根空骨架、无调用方 | 架构"注入 dataDir/接入服务"第一层断链；各层仍 `process.cwd()` | 高 |
| 缺陷-2 | adapter 契约只有 `run()`，无 fetchDiscovery/normalize/profile，忽略 signal | 每源增量成本估算失效；取消/优雅停止无通路 | 高 |
| 缺陷-3 | AI 双入口：digest/weekly+6 路由直连 lib/deepseek 绕过 provider 门面 | 计费/降级/错误口径可能漂移；换 provider 需逐处改 | 中 |
| 缺陷-4 | repository 契约（store/interface）纯类型占位零引用 | store 无真实抽象，换 Sqlite/垫片需重构 | 中 |
| 缺陷-5 | GitHub 未迁 sources/github 分区，D3"读旧先于新"垫片不存在 | "源分区"目标只对 HN 生效 | 中 |
| 缺陷-6 | per-source 调度（schedule.ts）未接线 | "改 cadence=改配置"未达成 | 中 |
| 缺陷-7 | source profile 被降级为"详情 URL 分派"，非 per-source signals 计算器 | "每源判读"停留在文档 | 中 |
| 缺陷-8 | JobKind 容纳 source:*，但数据更新未并入单飞锁 | web 更新与手工/定时 run-source 可并发写 latest | 中 |
| 缺陷-9 | eslint 边界未收紧（仅 scripts 守卫，已删），presentation 直连 core I/O 面 | A10"白名单"未达成 | 中 |
| 缺陷-10 | digest/weekly/radar 生成器仍驻 lib；日期纯函数 lib 重复 | 架构 §1 要消灭的"双份逻辑"残余 | 中 |
| 缺陷-11 | §4.10 板块类型 `FeedSection` 死代码，运行时用 `FeedSectionResult` | 命名/形状与契约不等，易混淆 | 低 |

### B. 待拍板风险（可能隐患 / 需取舍）

| 编号 | 风险 | 为何需拍板 |
|---|---|---|
| 风险-12 | `/hn/[id]` 只读当日快照，无历史回退 → 关注/旧条目 404 | 是否回退读历史 / 接受"仅当日" |
| 风险-13 | cross-digests 无限累积，无 TTL/清理 | 是否加保留天数 |
| 风险-14 | watchlist 只有单条 toggle，无清空/批量/独立视图 | 是否补管理页 |
| 风险-15 | README 缓存永久无 TTL（F10）、star 索引无 TTL 策略 | 是否需要时效 |
| 风险-16 | 工程加固 batch5 未做：F8 鉴权/F9 限流/F13 流不可取消；F12 digest 仍同步长请求 | 是否保持本地自用/加防护 |
| 风险-17 | adapter 对空/异常响应健壮性不足（空响应被当成功快照） | 是否加"空视为失败/告警" |
| 风险-18 | `FeedSection` 死代码 + `profile` 一词文档/代码语义分叉 | 是否重命名/补真 profile |

### C. 处置优先级建议

**建议优先（影响真实、改动力度可控）**
1. **缺陷-1 createCore 组合根**（用 `DATA_DIR` 常量替换 `process.cwd()`，真正接入 store/features/jobs）——理顺 A6 断链，为公开站/多实例留门。需先做行为基线。
2. **缺陷-3 AI 统一走 provider 门面**（digest/weekly/api 路由改 `createDeepSeekProvider`）——改动机械、收益明确。
3. **风险-16 F12 后台化**（digest 转 detached 子进程 + 复用 update 模式）——消除 120s 同步长连接；可与 F8/F9 一并按"是否暴露"决策。

**可权衡（按价值/痛点）**：缺陷-2/8/9（adapter 契约、source:* 落锁、边界收紧，偏架构完整性、改动大）；风险-12/14（HN 历史回退、watchlist 管理，随多源深度按需）；风险-13/15（TTL/清理，轻量）。

---

## 审阅确认

请逐批勾选是否执行,或直接回复:

- **「全部执行」** → 按批次 1→2→3→4 执行,批次 5 按你的勾选;
- **「执行批次 1/2」** → 只做指定批次;
- **对单项有异议** → 指出编号与你的期望,我调整后再动。
