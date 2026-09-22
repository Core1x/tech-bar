"use client";
// M4 §10.1 趋势雷达交互：近 7 日增量 Top 增加「绝对增长 ⇄ 相对增幅」切换（两口径不混排，切换而非并列），
// 每行迷你折线，勾选 2-5 个仓库叠加「相对首点累计增长曲线」对比（不同总量仓放同图必须归一，避免大 star 压平小 star）。
// 零图表依赖、纯 SVG；数据来自服务端 computeRadar（含 spark 最近 ≤10 点）。
import Link from "next/link";
import { useMemo, useState } from "react";
import { LangDot } from "./LangDot";
import { formatStars } from "./RepoRow";
import { Sparkline } from "./Sparkline";

export interface RadarTopRow {
  full_name: string;
  owner: string;
  name: string;
  stars: number;
  delta: number | null;
  pct: number | null;
  avgDaily: number | null;
  spanDays: number | null;
  points: number;
  language: string | null;
  description: string | null;
  summary?: string | null;
  spark?: { date: string; stars: number }[];
}

const OVERLAY_COLORS = ["#58a6ff", "#3fb950", "#d29922", "#f85149", "#bc8cff"];
const MAX_OVERLAY = 5;

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** 叠加对比折线图：x=各仓相对自身首个快照点的天数偏移，y=相对首点累计增长（各线独立归一，同图看形态） */
function OverlayChart({
  series,
  latestDate,
}: {
  series: { full_name: string; spark: { date: string; stars: number }[] }[];
  latestDate: string;
}) {
  const W = 560;
  const H = 220;
  const PAD_X = 48;
  const PAD_Y = 20;
  const DAY = 86_400_000;
  const endTs = Date.parse(latestDate + "T00:00:00Z");

  // 每条线：{daysAgo(负=过去), gain}；以各线最新点为 x=0 对齐（时间跨度不一，取 ≤14 天窗口）
  const lines = series.map((s) => {
    const base = s.spark[0].stars;
    const pts = s.spark.map((p) => ({
      x: Math.max(-14, Math.round((Date.parse(p.date + "T00:00:00Z") - endTs) / DAY)),
      y: p.stars - base,
    }));
    return { name: s.full_name, pts };
  });
  const allX = lines.flatMap((l) => l.pts.map((p) => p.x));
  const allY = lines.flatMap((l) => l.pts.map((p) => p.y));
  const minX = Math.min(-1, ...allX);
  const maxX = Math.max(0, ...allX);
  const minY = Math.min(0, ...allY);
  const maxY = Math.max(1, ...allY);
  const sx = (x: number) => PAD_X + ((x - minX) / (maxX - minX || 1)) * (W - PAD_X - 8);
  const sy = (y: number) => H - PAD_Y - ((y - minY) / (maxY - minY || 1)) * (H - PAD_Y * 2);

  const yTicks = [maxY, Math.round((maxY + minY) / 2), minY];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`叠加对比：${lines.map((l) => l.name).join("，")} 的相对增长曲线`}>
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={PAD_X} x2={W - 8} y1={sy(t)} y2={sy(t)} stroke="#21262d" strokeWidth={1} />
          <text x={PAD_X - 6} y={sy(t) + 3.5} textAnchor="end" fontSize={10} fill="#8b949e">
            {t >= 0 ? "+" : ""}{fmt(t)}
          </text>
        </g>
      ))}
      {/* x 轴（距最新快照的天数） */}
      <line x1={PAD_X} x2={W - 8} y1={sy(Math.max(0, minY))} y2={sy(Math.max(0, minY))} stroke="#484f58" strokeWidth={1} />
      {lines.map((l, i) => (
        <polyline
          key={l.name}
          points={l.pts.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ")}
          fill="none"
          stroke={OVERLAY_COLORS[i % OVERLAY_COLORS.length]}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {lines.map((l, i) => {
        const last = l.pts[l.pts.length - 1];
        return (
          <text key={l.name} x={PAD_X + 4} y={14 + i * 14} fontSize={11} fill={OVERLAY_COLORS[i % OVERLAY_COLORS.length]}>
            ● {l.name}（{last.y >= 0 ? "+" : ""}{fmt(last.y)}）
          </text>
        );
      })}
    </svg>
  );
}

export function RadarTopPanel({ rows, latestDate }: { rows: RadarTopRow[]; latestDate: string }) {
  const [sort, setSort] = useState<"delta" | "pct">("delta");
  const [selected, setSelected] = useState<string[]>([]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    if (sort === "pct") arr.sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity));
    else arr.sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));
    return arr;
  }, [rows, sort]);

  // 叠加系列：勾选顺序映射配色；spark 点数 <2 的自动过滤
  const overlay = selected
    .map((name) => rows.find((r) => r.full_name === name))
    .filter((r): r is RadarTopRow & { spark: NonNullable<RadarTopRow["spark"]> } => !!r && !!r.spark && r.spark.length >= 2)
    .map((r) => ({ full_name: r.full_name, spark: r.spark }));

  function toggle(name: string) {
    setSelected((cur) => {
      if (cur.includes(name)) return cur.filter((n) => n !== name);
      if (cur.length >= MAX_OVERLAY) return cur; // 满了不再加（提示见勾选框 disabled）
      return [...cur, name];
    });
  }

  if (rows.length === 0) {
    return <p className="px-3 py-3 text-sm text-[#8b949e]">暂无足够历史数据计算 7 日窗口</p>;
  }

  return (
    <div>
      {/* 口径切换 + 选择提示 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#21262d] px-3 py-2">
        <div className="flex items-center gap-1 rounded-md border border-[#30363d] bg-[#161b22] p-0.5 text-xs">
          <button
            onClick={() => setSort("delta")}
            className={`rounded px-2 py-1 transition-colors ${sort === "delta" ? "bg-[#30363d] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"}`}
          >
            绝对增长
          </button>
          <button
            onClick={() => setSort("pct")}
            className={`rounded px-2 py-1 transition-colors ${sort === "pct" ? "bg-[#30363d] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"}`}
          >
            相对增幅
          </button>
        </div>
        <span className="text-[11px] text-[#8b949e]">勾选 2-{MAX_OVERLAY} 个仓库叠加增长曲线对比</span>
      </div>

      {sorted.map((row, i) => {
        const checked = selected.includes(row.full_name);
        const disSel = !checked && selected.length >= MAX_OVERLAY;
        return (
          <div
            key={row.full_name}
            className="flex items-start gap-3 border-b border-[#21262d] px-3 py-3 transition-colors last:border-b-0 hover:bg-[#161b22]"
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disSel}
              onChange={() => toggle(row.full_name)}
              aria-label={`对比 ${row.full_name}`}
              className="mt-1.5 h-3.5 w-3.5 shrink-0 accent-[#58a6ff] disabled:opacity-30"
            />
            <span className="w-5 shrink-0 pt-0.5 text-right tabular-nums text-[#8b949e]">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link href={`/repo/${row.owner}/${row.name}`} className="break-all font-semibold text-[#58a6ff] hover:underline">
                  {row.full_name}
                </Link>
                <span className="flex items-center gap-1 text-xs text-[#8b949e]">
                  <LangDot language={row.language} />
                  {row.language ?? "—"}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-1 text-sm text-[#8b949e]">{row.summary || row.description || "（无描述）"}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3 pt-0.5">
              {row.spark && <Sparkline points={row.spark} />}
              <div className="flex w-32 flex-col items-end gap-0.5 text-sm">
                <span className="tabular-nums text-[#e6edf3]">★ {formatStars(row.stars)}</span>
                <span className="font-semibold tabular-nums text-[#3fb950]">
                  {sort === "pct"
                    ? row.pct !== null
                      ? `${row.pct >= 0 ? "+" : ""}${row.pct}%`
                      : "—"
                    : row.delta !== null
                      ? `+${formatStars(row.delta)}`
                      : "—"}
                </span>
                <span className="text-[11px] text-[#8b949e]">
                  {row.avgDaily !== null ? `日均 ${row.avgDaily}` : ""} · {row.points} 天
                </span>
              </div>
            </div>
          </div>
        );
      })}

      {overlay.length >= 2 && (
        <div className="border-t border-[#30363d] bg-[#0d1117] px-3 py-3">
          <p className="mb-1 text-xs text-[#8b949e]">叠加对比（纵轴＝相对各仓首个快照点的累计增长；横轴＝距 {latestDate} 的天数）</p>
          <OverlayChart series={overlay} latestDate={latestDate} />
        </div>
      )}
    </div>
  );
}
