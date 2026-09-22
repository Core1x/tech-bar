// 非 GitHub 源共享的 HTTP 取数重试（juejin/cnblogs 等国内直连源）：
// 瞬时网络错误（fetch failed/超时/连接重置）与 429/5xx 退避重试；其它 4xx 是端点契约问题，不重试直接返回。
// 纯 node 内置（与 api.ts 同款纪律）；attempts 含首次。
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  { attempts = 3, baseDelayMs = 1500 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  let lastErr: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
  }
  throw lastErr ?? new Error("请求失败");
}
