// 自动周报「冷启动锚点」：data/config/weekly-anchor.json —— 记录“首次可报的自然周”的周一。
// M2 由 lib/weekly-anchor.ts 迁入（逐字）；lib/weekly-anchor.ts 现为 re-export 垫片。
// 语义：首次开启自动周报（此前未开）时从开启当周周一起统计，绝不回补更早自然周；
// 首份完整周在开启当周结束后由下周一自动产出。关闭自动周报时应 clear（设置页触发）。
import fs from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "config", "weekly-anchor.json");

export interface WeeklyAnchor {
  /** 首个可报自然周的周一 YYYY-MM-DD */
  monday: string;
}

export async function readWeeklyAnchor(): Promise<WeeklyAnchor | null> {
  try {
    const o = JSON.parse(await fs.readFile(FILE, "utf-8")) as WeeklyAnchor;
    return o && typeof o.monday === "string" ? { monday: o.monday } : null;
  } catch {
    return null;
  }
}

export async function writeWeeklyAnchor(monday: string): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ monday }, null, 2) + "\n", "utf-8");
  await fs.rename(tmp, FILE);
}

export async function clearWeeklyAnchor(): Promise<void> {
  try {
    await fs.unlink(FILE);
  } catch {
    // 不存在即可
  }
}
