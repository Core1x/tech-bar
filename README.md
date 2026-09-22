# 技术信息聚合站

> 平台给你信息流，我给你**筛选与判断**——值不值得看、是活是死还是虚火、同类还有谁、适不适合你。

本地自用的技术信息站（Next.js 16 · 数据驱动 · 零额外后端）：把 **GitHub 趋势 + 掘金 + 博客园**（可插拔）汇成首页**统一信息流**，之上叠加确定性判读、「今日必须看」简报、项目决策 / 对比 / 同类选型与 AI 综述 / 洞察 / 周报。

**不配 AI Key 也能用**：榜单、决策结论、对比矩阵、关注跟踪全部确定性直出；AI 只是润色与叙事层。

## 为什么这么做

- **确定性优先**：简报候选、决策结论、风险 chips 全部来自可核实的规则与依据；AI 只被允许为已选结果写解释，不得改排名、不得编数字。
- **AI 产物可溯源**：每篇 AI 产物带生成时间 / 数据时间 / 来源指纹（`.meta.json` sidecar），数据一刷新即标「可重新生成」，旧正文保留——绝不拿旧结论冒充新数据。
- **整合不混比**：各源用自己的原生度量（star / 名次 / 热度）各自排序，跨源同主题互链串联，不混排成假总榜。
- **Token 可控**：AI 一律先查缓存（peek）、点按才生成；开「自动」也只延后到首次展开才消耗。
- **源可插拔、默认免梯子**：默认 GitHub + 掘金 + 博客园；外网源（HN）保留在注册表、默认关闭。

## 页面地图

| 路由 | 是什么 |
|---|---|
| `/` | 今日必须看简报（≤5 条·带可核实依据）+ 异常变化 + 统一信息流 + 一键更新 |
| `/hot` | GitHub 热榜存量榜：10 类目查询式实拉，技术性过滤 + 出榜理由可见（运行期零 AI） |
| `/find` | AI 智能寻找：自然语言 → 多路中英查询并集，字段级「为什么匹配」+ 结果筛选 |
| `/watch` | 关注中心：跨源 watchlist 持续跟踪，GitHub 关注仓自动进每日趋势采样 |
| `/compare` | 项目对比：本地对比篮 ≤4 仓 → 零 AI 事实矩阵 + 可选 AI 场景建议 |
| `/repo/{owner}/{name}` | 仓库详情：判读 chips、Star 趋势、项目决策卡（确定性结论 + AI 四段解释）、同类选型、README（缓存 + 按需翻译） |
| `/digest` · `/radar` | 每日洞察 · 趋势雷达（7 日增量/新入视野/降温/主题热度）+ 自然周 AI 周报 |
| `/settings` | AI 接入、功能开关、数据源启停、兴趣偏好（只影响简报加权） |

## 快速开始

环境要求：Node.js ≥ 18（建议 20+）。

```bash
npm install
npm run build:cli          # 构建数据 CLI（dist/cli/*.mjs）
node dist/cli/run-source.mjs all   # 首次拉取：生成今日数据
npm run dev                # http://localhost:3000
```

日常使用推荐生产模式（无按需编译开销、切页更快）：`npm run build && npm start`。
首次运行没有数据时，首页会显示引导。

## 配置

**全部可在线完成（设置页，保存即生效，免重启），也可走 `.env.local`（网页设置优先）**：

| 项 | 说明 |
|---|---|
| AI 接入 | Base URL / 模型 / Key——默认 DeepSeek，兼容任意 OpenAI 格式接口（中转站、本地 vLLM） |
| GitHub Token | 匿名 60 次/小时 → 5000 次/小时，是更新速度/成功率的最大杠杆 |
| 功能开关 | 日报/周报自动生成默认开；详情页决策/同类、首页简报推荐语、跨源综述默认关（按需开，token 可控） |
| 数据源启停 | 读写 `data/config/active-sources.json`，首页 Tab / 侧栏自动适配 |
| 兴趣偏好 | 语言/主题/正负主题偏向，**只**给「今日必须看」加权，不改变原始榜单 |

> **安全**：`data/`（Key、Token、全部运行数据）已被 `.gitignore` 排除，模板见 `data/config/*.example`。
> 什么都没配也能跑：仅 AI 相关功能降级为友好提示。

**加一个新源** = 一个 `core/sources/{id}/adapter` + `registry.ts` 登记一行 + 启用源清单加 id。

## 开发

```bash
npx tsc --noEmit && npm run lint && npm run test   # 类型 / 规范 / vitest 单测
npm run build:cli   # 改 core|cli 后必跑；npm run build 生产构建
```

## 深入文档

| 文档 | 内容 |
|---|---|
| [`docs/operations.md`](docs/operations.md) | **运维与数据参考**：数据文件清单、更新链路与耗时、定时任务、Agent 协作口径、已知行为 FAQ、目录结构 |
| [`docs/architecture.md`](docs/architecture.md) | 目标架构（本地分层单体、源 adapter 契约、ADR） |
| [`docs/execution-plan.md`](docs/execution-plan.md) | 现状与已验证功能的全量里程碑记录、设计约定、待办路线图 |
| [`docs/product-optimization-plan.md`](docs/product-optimization-plan.md) | 产品优化轮（M0–M5）完整规格 |
