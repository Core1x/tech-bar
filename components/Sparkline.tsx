// 迷你增长曲线（M4 §10.1）：纯 SVG polyline，零图表依赖，服务端可直渲。
// y 值取「相对首点的累计新增」——总 star 基线远大于增量，直接用原值会把增长趋势压平成直线。
export interface SparkPoint {
  date: string;
  stars: number;
}

export function Sparkline({
  points,
  width = 120,
  height = 34,
  color = "#3fb950",
  className,
}: {
  points: SparkPoint[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}) {
  if (points.length < 2) {
    return (
      <span className={`text-[10px] text-[#8b949e] ${className ?? ""}`} title="快照不足 2 天">
        —·—
      </span>
    );
  }
  const base = points[0].stars;
  const gains = points.map((p) => p.stars - base);
  const max = Math.max(...gains);
  const min = Math.min(...gains);
  const span = max - min || 1;
  const pad = 3;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (points.length - 1);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const line = gains.map((g, i) => `${x(i).toFixed(1)},${y(g).toFixed(1)}`).join(" ");
  const zeroY = y(0);
  const last = gains[gains.length - 1];
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={`近 ${points.length} 天快照累计${last >= 0 ? "新增" : "减少"} ${Math.abs(last).toLocaleString("en-US")} star`}
    >
      <title>{`${points[0].date} → ${points[points.length - 1].date}：${last >= 0 ? "+" : ""}${last.toLocaleString("en-US")} star`}</title>
      {/* 起点水平参考线（0 增量） */}
      <line x1={x(0)} x2={x(points.length - 1)} y1={zeroY} y2={zeroY} stroke="#30363d" strokeWidth={1} strokeDasharray="2 3" />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(last)} r={2.4} fill={color} />
    </svg>
  );
}
