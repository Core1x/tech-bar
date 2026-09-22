// 日期纯函数（自然周/缺口容忍 diff/本地日期串）——多源共用的**权威实现**（M1.2 建立）。
// 只抽纯函数，不搬调用方：scripts/_shared.mjs 镜像已随 M2 删除；
// lib/radar.ts、lib/weekly.ts 各自的日期本地副本仍被调用，收编时改指向本模块（以本文件为准校对）。
// 语义口径：自然周=周一~周日（mondayOf/lastSunday）；快照缺口日不假定连续（diffDays 用实数差值）。

export const DAY_MS = 86_400_000;

export const pad = (n: number): string => String(n).padStart(2, "0");

/** 本地日期 YYYY-MM-DD（对齐 +08:00 场景用本地时区而非 UTC；同 lib/digest 的 localDateStr 口径） */
export function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 本地时间 ISO 字符串（带时区偏移，如 2026-08-21T09:00:00+08:00）；updater/热榜采集等快照 updated_at 统一用此口径 */
export function localISO(d = new Date()): string {
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? "+" : "-";
  const abs = Math.abs(tz);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** YYYY-MM-DD → UTC 当天零点的毫秒数（解析日期串统一用 UTC 零点，避免时区漂移） */
export function parseDate(s: string): number {
  return Date.parse(s + "T00:00:00Z");
}

/** 日期串减去 n 天，仍为 YYYY-MM-DD */
export function dateMinusDays(s: string, days: number): string {
  return new Date(parseDate(s) - days * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(s: string, days: number): string {
  return new Date(parseDate(s) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 两日期串相差天数（b - a） */
export function diffDays(a: string, b: string): number {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

/** 日期 s 所在自然周（周一起）的周一 */
export function mondayOf(s: string): string {
  const dow = new Date(parseDate(s)).getUTCDay(); // 0=周日 … 6=周六
  return addDays(s, -((dow + 6) % 7));
}

/** 上一个「已完成」自然周的收盘日：日期 d 之前最近的一个周日（d 为周日时返回上周日，即下周一出上周报） */
export function lastSunday(d: string): string {
  return addDays(mondayOf(d), -1);
}
