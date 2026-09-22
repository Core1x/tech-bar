// 全局 AI/数据 批任务单飞锁（跨进程、文件级）——防止「网页手动」与「定时 CLI」并发触发同一任务：
// 双份 token、后者覆盖前者。本文件供 Next 进程内 /api/digest、/api/weekly、页面与 cli/daily 使用。
// M1.4 由 lib/jobs.ts 迁入并泛化：JobKind 由字面量 union 放宽为可扩展（digest/weekly/source:*），
// 规则与文件锁语义不变；脚本侧镜像已随 M2 删除；lib/jobs.ts 现为 re-export 垫片。
//
// 规则（满足“生成周报/日报时不要被其他流程打断”）：
//   1. digest 与 weekly 共用同一把锁 → 同一时刻只跑一个 AI 长任务（互斥，不并行）；
//   2. 同 kind、同 target 已在跑 → acquireJob 返回 null，调用方直接跳过（对方会产出该文件）；
//      不同 kind 在跑 → acquireJob 有界等待其释放后再拿锁（排队，不丢任务）；
//   3. 拿锁前检查数据更新(update-state.json)是否在跑 → 在跑则调用方直接拒绝（避免边更新边生成）。
// 锁文件 { pid, kind, target, startedAt } 用 O_EXCL 创建，跨进程原子；owner pid 已死或超时视为陈旧可回收。
import fs from "node:fs/promises";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const LOCK_FILE = path.join(CACHE_DIR, "gen-job.lock");
const STATE_FILE = path.join(CACHE_DIR, "gen-jobs.json");
const UPDATE_STATE_FILE = path.join(CACHE_DIR, "update-state.json");

/** 单次 AI 批任务远超此时间则视为陈旧（崩溃遗留） */
const STALE_MS = 20 * 60 * 1000;
/** 锁心跳超过此年龄未续视为僵尸（热重载使闭包消亡但 pid 仍存活，pid 判活失效，只能靠心跳） */
const LOCK_BEAT_MS = 90 * 1000;
/** 心跳步进 */
const BEAT_STEP_MS = 5000;
/** 跨 kind 等待的步进与上限：另一任务最多几分钟，给它留足时间跑完 */
const WAIT_STEP_MS = 2000;
const WAIT_TIMEOUT_MS = 5 * 60 * 1000;

/** 批任务类型：digest/weekly 沿用；数据更新并入后为 source:<sourceId>（M3 起） */
export type JobKind = 'digest' | 'weekly' | (string & {});

export interface GenJobState {
  running: { kind: JobKind; target?: string; pid: number; startedAt: string } | null;
  last: { kind: JobKind; target?: string; finishedAt: string; ok: boolean; message: string } | null;
}

/** 进程是否存活：kill(pid, 0) 不抛 = 存活；EPERM（存在但无权限）也算存活 */
function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readState(): Promise<GenJobState> {
  try {
    const obj = JSON.parse(await fs.readFile(STATE_FILE, "utf-8")) as GenJobState;
    return { running: obj.running ?? null, last: obj.last ?? null };
  } catch {
    return { running: null, last: null };
  }
}

async function writeState(state: GenJobState): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
  await fs.rename(tmp, STATE_FILE);
}

async function readLock(): Promise<{ pid: number; kind: JobKind; target?: string; startedAt: string } | null> {
  try {
    return JSON.parse(await fs.readFile(LOCK_FILE, "utf-8"));
  } catch {
    return null;
  }
}

/** 数据更新(update-trending 子进程)是否在跑——生成类任务应等它结束再开始 */
export async function isUpdateRunning(): Promise<boolean> {
  try {
    const obj = JSON.parse(await fs.readFile(UPDATE_STATE_FILE, "utf-8")) as { pid?: number | null };
    return Boolean(obj.pid && isAlive(obj.pid));
  } catch {
    return false;
  }
}

/** 独占尝试拿锁：ok=true 已持有；ok=false 给出占用者 kind/target */
async function tryTake(
  kind: JobKind,
  target?: string,
): Promise<{ ok: boolean; busyKind?: JobKind; busyTarget?: string }> {
  const startedAt = new Date().toISOString();
  const payload = JSON.stringify({ pid: process.pid, kind, target, startedAt });
  const create = async () => {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(LOCK_FILE, payload, { flag: "wx" });
      return true;
    } catch {
      return false;
    }
  };
  if (await create()) return { ok: true };
  // 锁已存在：owner 存活 + 心跳新鲜 + 未超时 → 被占用；否则视为陈旧，回收后重试一次。
  // 心跳判据必不可少：Next dev 热重载会杀掉后台任务闭包但进程（pid）仍存活，仅靠 isAlive 会留下僵尸锁。
  const lock = await readLock();
  if (lock) {
    let beatAge = Number.POSITIVE_INFINITY;
    try {
      beatAge = Date.now() - (await fs.stat(LOCK_FILE)).mtimeMs;
    } catch {
      beatAge = Number.POSITIVE_INFINITY; // 锁文件已被并发回收
    }
    const stale =
      !isAlive(lock.pid) ||
      beatAge > LOCK_BEAT_MS ||
      Date.now() - Date.parse(lock.startedAt) > STALE_MS;
    if (!stale) return { ok: false, busyKind: lock.kind, busyTarget: lock.target };
    try {
      await fs.unlink(LOCK_FILE);
    } catch {
      // 已被并发回收，继续走重试
    }
    if (await create()) return { ok: true };
  }
  return { ok: false };
}

/**
 * 锁心跳：acquireJob 成功后立即启动，每 5s 刷锁文件 mtime；任务结束（finishJob 前后）必须调用返回的 stop()。
 * 持锁任务一律启用——tryTake 的僵尸回收依赖心跳新鲜度（pid 判活无法识别「同进程内闭包已死」）。
 * interval 已 unref：漏 stop 也不会拖住 CLI 进程退出。
 */
export function startLockHeartbeat(): () => void {
  const touch = () => fs.utimes(LOCK_FILE, new Date(), new Date()).catch(() => {});
  void touch();
  const id = setInterval(touch, BEAT_STEP_MS);
  id.unref?.();
  return () => clearInterval(id);
}

/**
 * 获取「AI 长任务」单飞锁（digest/weekly 互斥；未来 source:* 同规则）：
 * - 同 kind 且同 target 已在跑 → 返回 null（对方会产出该文件，直接跳过）；
 * - 不同 kind 在跑 → 有界等待其释放后再拿锁（排队，不丢任务）；
 * - 等待超时仍没轮到 → 返回 null（调用方让 UI 稍后再试）。
 * 拿到锁后必须调 finishJob(pid) 释放。
 */
export async function acquireJob(kind: JobKind, target?: string): Promise<number | null> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    const r = await tryTake(kind, target);
    if (r.ok) {
      await writeState({
        running: { kind, target, pid: process.pid, startedAt: new Date().toISOString() },
        last: (await readState()).last,
      });
      return process.pid;
    }
    // 同一种、同一个目标已在生成：直接让位，等对方产出
    if (r.busyKind === kind && (r.busyTarget === target || r.busyTarget === undefined || target === undefined)) {
      return null;
    }
    if (Date.now() > deadline) return null;
    await new Promise((res) => setTimeout(res, WAIT_STEP_MS));
  }
}

/** 释放锁并记录结果（供 UI 的“生成中/上次结果”展示）。
 * 顺序关键：先落 running:null（此刻仍持有锁，等待者无法写入），再 unlink 放锁，
 * 避免“先放锁后写状态”时另一个等待者已抢到锁、running 被我们误清。 */
export async function finishJob(
  pid: number,
  kind: JobKind,
  ok: boolean,
  message: string,
  target?: string,
): Promise<void> {
  await writeState({
    running: null,
    last: {
      kind,
      target,
      finishedAt: new Date().toISOString(),
      ok,
      message: message || (ok ? "生成完成" : "生成失败"),
    },
  });
  try {
    const lock = await readLock();
    if (lock && lock.pid === pid) await fs.unlink(LOCK_FILE);
  } catch {
    // 忽略
  }
}

/**
 * 当前真实在跑的批任务（过滤掉进程已死的陈旧状态）。
 * 无任务返回 null；否则给 { kind, target, startedAt } 供页面渲染“生成中”。
 */
export async function runningJob(): Promise<GenJobState["running"]> {
  const s = await readState();
  if (!s.running) return null;
  if (!isAlive(s.running.pid) || Date.now() - Date.parse(s.running.startedAt) > STALE_MS) return null;
  // 心跳判据：同进程闭包被热重载杀掉时 pid 仍存活、状态文件仍是 running——锁文件消失或心跳过期即视为已死
  try {
    const st = await fs.stat(LOCK_FILE);
    if (Date.now() - st.mtimeMs > LOCK_BEAT_MS) return null;
  } catch {
    return null; // 锁已释放/被回收
  }
  return s.running;
}

/** 上次批任务结果（供状态接口/日志） */
export async function lastJobResult(): Promise<GenJobState["last"]> {
  return (await readState()).last;
}
