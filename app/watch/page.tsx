// /watch 关注中心（M2，product-optimization-plan §8）：所有关注条目（GitHub 仓库 + 文章）的独立页，
// 不依赖"还在不在今日榜单"——今日在榜的实时展示原生度量与变化；离榜的用关注快照兜底展示最后已知信息；
// 旧记录（无快照）标「历史关注」；GitHub 关注仓库经每日采样积累趋势（updater ∪ watchlist）。
// 数据装配全服务端（watchlist + buildFeed + latest.tracked），客户端 WatchBoard 只做过滤/排序/取消关注。
import { buildFeed } from "@/core/analysis/feed";
import { readLatest, readWatchlist, watchlistKey } from "@/core/store/file";
import { itemHrefFor } from "@/core/analysis/profile";
import type { FeedItem } from "@/core/domain/types";
import { WatchBoard, type WatchRow } from "@/components/WatchBoard";

export const dynamic = "force-dynamic";

export default async function WatchPage() {
  const [entries, sections, latest] = await Promise.all([readWatchlist(), buildFeed(), readLatest()]);

  const liveByKey = new Map<string, FeedItem>();
  for (const s of sections) for (const it of s.items) liveByKey.set(it.key, it);
  const trackedByName = new Map((latest?.tracked ?? []).map((t) => [t.full_name, t]));

  const rows: WatchRow[] = entries.map((e) => {
    const key = watchlistKey(e.source, e.source_id);
    const live = liveByKey.get(key);
    const isGithub = e.source === "github";
    const gh = isGithub ? trackedByName.get(e.source_id) : undefined;
    const snap = e.snapshot;

    const title = live?.title ?? snap?.title ?? (isGithub ? e.source_id : "");
    const url = live?.url ?? snap?.url ?? (isGithub ? `https://github.com/${e.source_id}` : "");
    const detailHref = (isGithub ? `/repo/${e.source_id}` : itemHrefFor(e.source, e.source_id)) || url;

    let metric: string | null = null;
    let delta: number | null = null;
    let change: string;
    let changedToday = false;
    let status: WatchRow["status"] = "live";

    if (isGithub) {
      if (live) {
        metric = live.metric?.label ?? null;
        change = "今日在 GitHub 榜单";
        changedToday = true;
      } else if (gh) {
        metric = `★ ${gh.stars.toLocaleString("en-US")}`;
        if (gh.dataUpdatedAt) {
          // 限流/失败回退：标 last-known 时刻，不冒充刚更新（§8.3 配额条款）
          status = "stale";
          change = `数据为 ${gh.dataUpdatedAt.slice(0, 10)} 的最后已知记录（本轮拉取未成功）`;
        } else {
          delta = gh.delta_1d ?? null;
          changedToday = true;
          change =
            gh.delta_1d === null || gh.delta_1d === undefined
              ? "今日已采样（无对比基准）"
              : gh.delta_1d > 0
                ? `今日新增 +${gh.delta_1d.toLocaleString("en-US")}`
                : "今日新增 0";
        }
      } else {
        status = "sampling";
        change = "已加入每日采样，趋势数据从下一次更新开始积累";
      }
    } else if (live) {
      metric = live.metric?.label ?? null;
      change = `今日在${live.sourceLabel}榜单`;
      changedToday = true;
    } else if (snap) {
      status = "offlist";
      metric = snap.lastMetricLabel ?? null;
      change = `已离开今日榜单 · 最后记录 ${snap.capturedAt.slice(0, 10)}`;
    } else {
      status = "legacy";
      change = "历史关注 · 未记录标题与度量（旧版本数据，无快照）";
    }

    return {
      key,
      source: e.source,
      sourceId: e.source_id,
      isGithub,
      title: title || `（未知条目 ${e.source_id}）`,
      url,
      detailHref,
      description: live?.description ?? snap?.description ?? null,
      metric,
      delta,
      change,
      changedToday,
      status,
      addedAt: e.addedAt,
      capturedAt: snap?.capturedAt ?? null,
    };
  });

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-16">
      <WatchBoard
        rows={rows}
        total={rows.length}
        changedToday={rows.filter((r) => r.changedToday).length}
        dataUpdatedAt={latest?.updated_at ?? null}
      />
    </main>
  );
}
