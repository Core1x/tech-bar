// /api/hot —— GitHub 热榜「重建」后台任务（存量榜 /hot 页手动入口）。
// POST：后台 detached 启动 `node dist/cli/hot.mjs rebuild`（纯 searchRepos、零 AI，约 20 笔查询式），立即返回。
// GET ：查询任务状态 { running, lastResult }，前端轮询。
// 状态落盘 data/cache/hot-state.json（仿 /api/update：进程重启后仍能识别 detached 子进程在跑，避免并发重建）。
// 依赖 `npm run build:cli` 已产出 dist/cli/hot.mjs（与「立即更新」同一约束）。
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { openSync, closeSync } from "node:fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_FILE = path.join(process.cwd(), "data", "cache", "hot-state.json");
const LOG_FILE = path.join(process.cwd(), "data", "logs", "hot.log");

interface HotState {
  pid: number | null;
  startedAt: string | null;
  code: number | null;
  message: string | null;
  finishedAt: string | null;
}
const EMPTY: HotState = { pid: null, startedAt: null, code: null, message: null, finishedAt: null };

function messageFor(code: number): string {
  if (code === 0) return "热榜重建完成";
  if (code === 2) return "配额不足，已保存部分榜单，稍后可再重建一次";
  if (code === 1) return "重建失败（无类目配置或搜索异常）";
  return "重建失败，请稍后重试";
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readState(): Promise<HotState> {
  try {
    return { ...EMPTY, ...(JSON.parse(await fs.readFile(STATE_FILE, "utf-8")) as Partial<HotState>) };
  } catch {
    return { ...EMPTY };
  }
}
async function writeState(s: HotState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s), "utf-8");
  await fs.rename(tmp, STATE_FILE);
}

export async function POST() {
  const state = await readState();
  if (state.pid && isAlive(state.pid)) {
    return Response.json({ error: "已有热榜重建正在进行中，请稍候" }, { status: 409 });
  }

  const cli = path.join(process.cwd(), "dist", "cli", "hot.mjs");
  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  let logFd: number;
  try {
    logFd = openSync(LOG_FILE, "a");
  } catch {
    return Response.json({ error: "无法创建日志文件" }, { status: 500 });
  }
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(process.execPath, [cli, "rebuild"], {
      cwd: process.cwd(),
      windowsHide: true,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
  } catch {
    try {
      closeSync(logFd);
    } catch {
      /* ignore */
    }
    await writeState({ ...EMPTY, code: -1, message: messageFor(-1), finishedAt: new Date().toISOString() });
    return Response.json({ error: "启动重建脚本失败（先跑 npm run build:cli）" }, { status: 500 });
  }
  child.unref();
  await writeState({ pid: child.pid ?? null, startedAt: new Date().toISOString(), code: null, message: null, finishedAt: null });

  const finish = (code: number) => {
    try {
      closeSync(logFd);
    } catch {
      /* ignore */
    }
    void writeState({ ...EMPTY, code, message: messageFor(code), finishedAt: new Date().toISOString() });
  };
  child.on("close", (code) => finish(code ?? -1));
  child.on("error", () => finish(-1));

  return Response.json({ ok: true, message: "已在后台开始重建热榜" });
}

export async function GET() {
  const state = await readState();
  const running = !!state.pid && state.finishedAt === null && isAlive(state.pid);
  return Response.json({
    running,
    lastResult: state.finishedAt ? { code: state.code, message: state.message, finishedAt: state.finishedAt } : null,
  });
}
