// 项目判读——确定性信号引擎（纯函数、零 I/O、无 hooks，服务端/客户端均可 import）
// M1.2 由 lib/signals.ts 迁入；lib/signals.ts 现为 re-export 垫片。
// 职责：把 GitHub 即时公开字段（pushed_at/archived/license）换算成「保守」的维护/许可信号 chips。
// 原则：只标硬旗，不轻易对"新/火/冷门"下结论；每条 chip 带可复核 detail（悬停溯源）。
// 任何信号都缺失 → 返回空 Verdict，调用方渲染 nothing（回填前优雅降级）。
// 多源化：将来每源一个 profile（computeSignals(item)→Verdict 形态），GitHub 规则在此原样保留。

export type VerdictLevel = "attention" | "warn" | "good" | null; // null = 无数据
export type ChipTone = "red" | "amber" | "green";
export type ChipKind = "archived" | "stale" | "slow" | "active" | "no-license";

/** 结构上可接受 NewStarRepo / TrackedRepo / FindRepo / 路由内联对象 */
export interface VerdictSource {
  pushed_at?: string | null; // ISO 或 "YYYY-MM-DD"；null/缺省 = 未知
  archived?: boolean | null; // false = 健康；缺省 = 未知
  license?: string | null; // SPDX 串；null = 无许可；缺省 = 未知
}

export interface VerdictChip {
  kind: ChipKind;
  tone: ChipTone;
  label: string;
  detail: string; // tooltip 溯源文案
}

export interface Verdict {
  level: VerdictLevel;
  chips: VerdictChip[];
  lastPushDays: number | null;
}

const DAY_MS = 86_400_000;

/** 上次 push 距今的天数（无效/缺失 → null）；now 可注入便于测试 */
export function lastPushAgeDays(pushedAt: string | null | undefined, now: Date = new Date()): number | null {
  if (typeof pushedAt !== "string" || pushedAt.length === 0) return null;
  const t = new Date(pushedAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

export function computeSignals(repo: VerdictSource, now: Date = new Date()): Verdict {
  const archKnown = repo.archived === true || repo.archived === false;
  const pushKnown = typeof repo.pushed_at === "string" && repo.pushed_at.length > 0;
  const licKnown = repo.license === null || typeof repo.license === "string";
  if (!archKnown && !pushKnown && !licKnown) {
    return { level: null, chips: [], lastPushDays: null };
  }

  const days = pushKnown ? lastPushAgeDays(repo.pushed_at, now) : null;
  const chips: VerdictChip[] = [];

  if (repo.archived === true) {
    chips.push({ kind: "archived", tone: "red", label: "已归档", detail: "仓库已被作者归档，通常不再维护" });
  } else if (pushKnown && days !== null) {
    // 归档日期对"维护期"无意义，已归档时跳过维护期判定（避免红标叠红标）
    if (days > 365) {
      chips.push({ kind: "stale", tone: "red", label: "超1年未更新", detail: `上次 push 距今约 ${days} 天` });
    } else if (days >= 180) {
      chips.push({ kind: "slow", tone: "amber", label: "更新放缓", detail: `上次 push 距今约 ${days} 天` });
    } else if (days <= 30) {
      chips.push({ kind: "active", tone: "green", label: "活跃维护", detail: `上次 push 距今约 ${days} 天` });
    }
    // 31–179 天 → 保守，不标（活跃度中性区间）
  }

  if (repo.license === null || repo.license === "") {
    chips.push({
      kind: "no-license",
      tone: "amber",
      label: "无开源许可证",
      detail: "GitHub 未检测到开源许可证，使用/再分发需自行确认授权",
    });
  }

  const level: VerdictLevel = chips.some((c) => c.tone === "red")
    ? "attention"
    : chips.some((c) => c.tone === "amber")
      ? "warn"
      : chips.length > 0
        ? "good"
        : null;

  return { level, chips, lastPushDays: days };
}
