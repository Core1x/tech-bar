// M3（§9.4）全局「对比篮」：最多 4 个 GitHub 仓库，仅存 localStorage（本地单用户，不进账号/服务端同步）。
// 纯模块级 store + useSyncExternalStore（同 floating-store 模式）；SSR 快照恒为空数组。
// 多标签页：storage 事件同步（读值失败静默，隐私模式不崩）。
const KEY = "compare:basket";
export const COMPARE_MAX = 4;

let basket: string[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(basket));
  } catch {
    // 隐私模式：内存态照常工作，只是刷新不保留
  }
}

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(arr)) basket = arr.filter((x): x is string => typeof x === "string").slice(0, COMPARE_MAX);
  } catch {
    basket = [];
  }
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    try {
      const arr = e.newValue ? (JSON.parse(e.newValue) as unknown) : [];
      basket = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string").slice(0, COMPARE_MAX) : [];
    } catch {
      basket = [];
    }
    for (const l of listeners) l();
  });
}

/** useSyncExternalStore 客户端快照（引用稳定：数组不变时不触发重渲染） */
export function getCompareSnapshot(): string[] {
  ensureLoaded();
  return basket;
}

/** SSR 快照必须是引用稳定的单例（新数组会触发 useSyncExternalStore 无限重渲染） */
const EMPTY_SNAPSHOT: string[] = [];
export function getCompareServerSnapshot(): string[] {
  return EMPTY_SNAPSHOT;
}

function emit(next: string[]) {
  basket = next;
  persist();
  for (const l of listeners) l();
}

export function subscribeCompare(l: () => void): () => void {
  ensureLoaded();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function inCompare(fullName: string): boolean {
  ensureLoaded();
  return basket.includes(fullName);
}

/** 加入（已满/已存在返回 false） */
export function addToCompare(fullName: string): boolean {
  ensureLoaded();
  if (basket.includes(fullName)) return false;
  if (basket.length >= COMPARE_MAX) return false;
  emit([...basket, fullName]);
  return true;
}

export function removeFromCompare(fullName: string): void {
  ensureLoaded();
  emit(basket.filter((n) => n !== fullName));
}

export function toggleCompare(fullName: string): void {
  if (inCompare(fullName)) removeFromCompare(fullName);
  else addToCompare(fullName);
}

export function clearCompare(): void {
  emit([]);
}
