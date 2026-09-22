// 数字/star 展示格式化工具（跨组件复用）
// M1.2 由 lib/format.ts 迁入；lib/format.ts 现为 re-export 垫片。
// formatStars = 千分位（榜单/详情页）；formatStarsCompact = 紧凑缩写（列表小场景）

/** 千分位，如 1234567 → "1,234,567" */
export function formatStars(n: number): string {
  return n.toLocaleString("en-US");
}

/** 紧凑缩写，如 1234567 → "1.2k" */
export function formatStarsCompact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
