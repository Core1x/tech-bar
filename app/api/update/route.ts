// POST /api/update — 后台启动「拉取全部启用源数据」（GitHub + 掘金 + 博客园等，立即返回，任务在服务端后台执行）
// GET  /api/update — 查询后台任务状态 { running, progress, lastResult }
// 退出码：0 全成功 / 1 有源失败 / 2 有源限流部分成功（已保存部分，可稍后重试补齐）
// 并发保护：同一时刻只允许一个更新任务
//
// 任务状态落盘 data/cache/update-state.json（而非模块级变量），
// 这样进程（dev server / 生产）重启后仍能识别「有 detached 子进程在跑」，
// 避免重启后再次点击更新导致两个脚本并发互相覆盖 latest.json。
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { openSync, closeSync } from "node:fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 后台脚本写入的进度文件（stage: start | fetch，done/total） */
const PROGRESS_FILE = path.join(process.cwd(), "data", "cache", "update-progress.json");
/** 后台脚本的完整日志（stdout/stderr 落到这里，方便排查失败原因） */
const LOG_FILE = path.join(process.cwd(), "data", "logs", "update-trending.log");
/** 更新任务状态文件（pid + 结果），进程重启后仍可识别运行中任务 */
const STATE_FILE = path.join(process.cwd(), "data", "cache", "update-state.json");

interface UpdateState {
  pid: number | null;
  startedAt: string | null;
  code: number | null;
  message: string | null;
  finishedAt: string | null;
}

const EMPTY_STATE: UpdateState = { pid: null, startedAt: null, code: null, message: null, finishedAt: null };

function messageFor(code: number): string {
  if (code === 0) return "全部启用源更新完成";
  if (code === 2) return "有源配额不足，已保存部分数据，稍后可再试一次补齐";
  return "更新失败，部分源未成功，请稍后重试";
}

/** 进程是否存活：kill(pid, 0) 不抛错 = 存活；EPERM（存在但无权限）也视为存活 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readState(): Promise<UpdateState> {
  try {
    const obj = JSON.parse(await fs.readFile(STATE_FILE, "utf-8")) as Partial<UpdateState>;
    return { ...EMPTY_STATE, ...obj };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function writeState(state: UpdateState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state), "utf-8");
  await fs.rename(tmp, STATE_FILE);
}

export async function POST() {
  const state = await readState();
  // 有存活的任务进程 → 拒绝新任务（含进程重启后遗留的 detached 子进程）
  if (state.pid && isAlive(state.pid)) {
    return Response.json({ error: "已有更新正在进行中，请稍候" }, { status: 409 });
  }

  // 数据更新引擎现驻 core（node dist/cli/run-source.mjs all = 全部启用源）；需先 npm run build:cli 产出
  const cli = path.join(process.cwd(), "dist", "cli", "run-source.mjs");
  // detached + unref：子进程独立于请求与 dev server 生命周期，纯后台执行；
  // 输出落盘到 data/logs/update-trending.log，便于排查更新失败原因
  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  const logFd = openSync(LOG_FILE, "a");
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(process.execPath, [cli, "all"], {
      cwd: process.cwd(),
      windowsHide: true,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
  } catch {
    try {
      closeSync(logFd);
    } catch {
      // 忽略
    }
    await writeState({ pid: null, startedAt: null, code: -1, message: messageFor(-1), finishedAt: new Date().toISOString() });
    return Response.json({ error: "启动更新脚本失败" }, { status: 500 });
  }
  child.unref();
  // 先记录子进程 pid，进程重启后也能探测到它仍在跑（spawn 后 pid 同步可用）
  await writeState({ pid: child.pid ?? null, startedAt: new Date().toISOString(), code: null, message: null, finishedAt: null });

  const finish = (code: number) => {
    try {
      closeSync(logFd);
    } catch {
      // fd 已关闭等，忽略
    }
    void writeState({ pid: null, startedAt: null, code, message: messageFor(code), finishedAt: new Date().toISOString() });
  };

  child.on("close", (code) => finish(code ?? -1));
  child.on("error", () => finish(-1));

  return Response.json({ ok: true, message: "已在后台开始更新" });
}

export async function GET() {
  const state = await readState();
  const running = !!state.pid && state.finishedAt === null && isAlive(state.pid);

  let progress: { stage: string; done: number; total: number } | null = null;
  if (running) {
    try {
      progress = JSON.parse(await fs.readFile(PROGRESS_FILE, "utf-8")) as {
        stage: string;
        done: number;
        total: number;
      };
    } catch {
      // 进程刚启动、进度文件尚未写入 → 前端显示为不确定进度
    }
  }

  return Response.json({
    running,
    progress,
    lastResult: state.finishedAt
      ? { code: state.code, message: state.message, finishedAt: state.finishedAt }
      : null,
  });
}
