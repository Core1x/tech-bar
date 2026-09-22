// star 趋势小图：遍历 data/history/*.json 提取的序列，手绘 SVG polyline（零图表库）
// 快照不足 2 天时显示「数据积累中」；2~3 天仍画图但标注「样本不足，暂不能判断趋势」（M3 §9.3）
export interface StarPoint {
  date: string;
  stars: number;
}

const W = 560;
const H = 150;
const PAD_X = 44;
const PAD_Y = 18;

/** y 轴刻度用紧凑格式，避免大数字（如 209,815）向左超出 SVG viewBox 被裁掉 */
function formatAxis(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return v.toLocaleString("en-US");
}

export function StarTrendChart({ points }: { points: StarPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-[#30363d] bg-[#161b22] text-sm text-[#8b949e]">
        数据积累中（需至少 2 天的历史快照）
      </div>
    );
  }

  const values = points.map((p) => p.stars);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const xs = (i: number) => PAD_X + (i * (W - PAD_X * 2)) / (points.length - 1);
  const ys = (v: number) => H - PAD_Y - ((v - min) / span) * (H - PAD_Y * 2);

  const linePoints = points.map((p, i) => `${xs(i).toFixed(1)},${ys(p.stars).toFixed(1)}`);
  const last = points[points.length - 1];
  const lastX = xs(points.length - 1);
  const lastY = ys(last.stars);

  // y 轴刻度：min / 中点 / max
  const mid = Math.round((min + max) / 2);
  const ticks = [max, mid, min];

  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`star 趋势：${points.map((p) => `${p.date} ${p.stars}`).join("，")}`}>
        {/* 网格线 + y 轴刻度 */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_X}
              x2={W - 4}
              y1={ys(t)}
              y2={ys(t)}
              stroke="#21262d"
              strokeWidth={1}
            />
            <text x={PAD_X - 6} y={ys(t) + 3.5} textAnchor="end" fontSize={10} fill="#8b949e">
              {formatAxis(t)}
            </text>
          </g>
        ))}
        {/* 折线 */}
        <polyline
          points={linePoints.join(" ")}
          fill="none"
          stroke="#58a6ff"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* 末点圆点 */}
        <circle cx={lastX} cy={lastY} r={3.5} fill="#f78166" />
        {/* x 轴首尾日期 */}
        <text x={PAD_X} y={H - 4} fontSize={10} fill="#8b949e">
          {points[0].date}
        </text>
        <text x={W - 4} y={H - 4} textAnchor="end" fontSize={10} fill="#8b949e">
          {last.date}
        </text>
      </svg>
      <p className="mt-1 flex items-center justify-end gap-2 text-right text-xs text-[#8b949e]">
        {points.length < 3 && (
          <span className="rounded-full border border-[#d29922]/40 bg-[#d29922]/10 px-2 py-0.5 text-[11px] text-[#d29922]">
            样本不足，暂不能判断趋势
          </span>
        )}
        <span>
          {points.length} 天快照 · 最新 {last.stars.toLocaleString("en-US")} ★
        </span>
      </p>
    </div>
  );
}
