// GitHub Explore 趋势榜抓取（https://github.com/trending?since=daily）。
// 背景：GitHub 无官方 trending API。旧口径（Search created:>30天 按总 star 排序）实际是"新星榜"，
// 与 Explore「按当日新增 star 排」的趋势榜差异大、且窗口内越早创建的仓库越霸榜、长期不变。
// 本模块直接抓 Explore 页面 HTML（走 github.com，不占 API 配额），正则解析 <article class="Box-row">。
// 网络失败/结构变更解析不出 → 返回 null，调用方（updater）降级沿用旧口径，绝不阻塞整轮数据更新。
// 零依赖（core/updater 纪律：node 内置 fetch/net/tls/https；勿引 cheerio/undici 等）。
// 网络路径（2026-09-11 实测）：api.github.com 直连稳定，但 github.com 页面直连常被重置/超时。
// 因此抓取按序尝试：直连 → HTTPS_PROXY/GITHUB_TRENDING_PROXY 环境变量代理 → 本地 127.0.0.1:7897
// （Clash/mihomo 常见混合端口，未监听时毫秒级拒绝、无副作用）。全失败 → null（feed 回落新星榜）。
import net from "node:net";
import tls from "node:tls";
import https from "node:https";

/** 页面解析出的原始趋势条目（详情字段由 updater 富化后另存 TrendingRepo） */
export interface RawTrendingRepo {
  rank: number;
  full_name: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number | null;
  stars_today: number;
  html_url: string;
}

/** 单个网络路径（直连/代理）的抓取超时；多路径依次尝试，总耗时仍远小于整轮更新 */
const TRENDING_FETCH_TIMEOUT_MS = 20_000;

const PAGE_HEADERS: Record<string, string> = {
  // 不带 UA 时部分网络路径会拿到验证页/403
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
  Accept: "text/html",
  "Accept-Language": "en-US,en;q=0.9",
};
const TRENDING_URL = "https://github.com/trending";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** 安全码点转换（代理区/超限码点保留原文，避免 fromCodePoint 抛） */
function fromCode(code: number): string | null {
  if (!Number.isFinite(code) || code < 0 || code > 0x10fffd) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;
  try {
    return String.fromCodePoint(code);
  } catch {
    return null;
  }
}

/** 解 HTML 实体（命名 + 数字）；仅用于描述等纯文本字段 */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ref: string) => {
    if (ref[0] === "#") {
      const hex = ref[1] === "x" || ref[1] === "X";
      const code = parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
      return fromCode(code) ?? m;
    }
    return ENTITIES[ref.toLowerCase()] ?? m;
  });
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function toInt(s: string | null): number | null {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * 解析 github.com/trending 页面 HTML → 条目数组（顺序=页面名次）。
 * 导出纯函数供单测直接喂 fixture。结构假设（2026-09 实测）：
 *   <article class="Box-row"> 内
 *   - <h2 class="h3 lh-condensed">…<a href="/owner/repo">
 *   - <p class="col-9 …">描述
 *   - <span itemprop="programmingLanguage">语言
 *   - <a href="/owner/repo/stargazers">…★总数、<a href="/owner/repo/forks">…fork 数
 *   - “N stars today”（since=daily）
 */
export function parseTrendingHtml(html: string): RawTrendingRepo[] {
  const out: RawTrendingRepo[] = [];
  const articles = html.match(/<article class="Box-row">[\s\S]*?<\/article>/g) ?? [];
  for (const chunk of articles) {
    const href = chunk.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^"?]+)"/)?.[1];
    if (!href) continue;
    const full_name = collapse(decodeEntities(href)); // 形如 owner/repo
    if (!full_name.includes("/")) continue;

    const descRaw = chunk.match(/<p class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1];
    const description = descRaw ? collapse(decodeEntities(stripTags(descRaw))) || null : null;

    const language = chunk.match(/<span itemprop="programmingLanguage">([^<]+)<\/span>/)?.[1]?.trim() ?? null;

    // 锚文本 = svg（含 height/viewBox 等数字属性）+ 尾部计数；先剥标签防误抓 svg 属性数字
    const anchorCount = (tail: "stargazers" | "forks") => {
      const m = chunk.match(new RegExp(`href="\\/[^"]+\\/${tail}"[^>]*>([\\s\\S]*?)<\\/a>`));
      if (!m) return null;
      return collapse(stripTags(m[1])).match(/([\d,]+)$/)?.[1] ?? null;
    };
    const stars = toInt(anchorCount("stargazers"));
    const forks = toInt(anchorCount("forks"));

    // “3,882 stars today”（svg 图标后纯文本；兼容单数与 weekly/monthly 文案）
    const todayRaw = chunk.match(/([\d,]+)\s+stars?\s+(today|this week|this month)/)?.[1];
    const stars_today = toInt(todayRaw ?? null) ?? 0;

    if (stars === null) continue; // 解析不出总 star 视为该条无效（结构可能已变）
    out.push({
      rank: out.length + 1,
      full_name,
      description,
      language,
      stars,
      forks,
      stars_today,
      html_url: `https://github.com/${full_name}`,
    });
  }
  return out;
}

/** 直连抓页面 HTML；失败返回 null（不抛） */
async function getHtmlDirect(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: PAGE_HEADERS,
      signal: AbortSignal.timeout(TRENDING_FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[趋势] 直连 HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    const code = (err as { cause?: { code?: string } })?.cause?.code;
    console.warn(`[趋势] 直连失败（${code ?? (err as Error).name}）`);
    return null;
  }
}

/**
 * 经 HTTP 代理（CONNECT 隧道 + TLS）抓页面 HTML。零依赖：net CONNECT → tls.connect → https.request(custom createConnection)。
 * 用途：github.com 页面直连常被重置而 api.github.com 不受影响；本机 Clash/mihomo 类代理（127.0.0.1:7897）是稳定路径。
 */
function getHtmlViaProxy(proxyUrl: string, targetUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = new URL(proxyUrl);
    const t = new URL(targetUrl);
    const proxy = net.connect({ host: p.hostname, port: Number(p.port || 80) });
    let settled = false;
    /** 收尾一次（resolve/reject 只认第一次）；timer 统一在此清除 */
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(
      () => done(() => { proxy.destroy(); reject(new Error("代理连接超时")); }),
      TRENDING_FETCH_TIMEOUT_MS,
    );
    proxy.on("error", (e) => done(() => { proxy.destroy(); reject(e); }));

    let buf = Buffer.alloc(0);
    const onHandshake = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const end = buf.indexOf("\r\n\r\n");
      if (end === -1) {
        if (buf.length > 65_536) done(() => { proxy.destroy(); reject(new Error("CONNECT 响应异常")); });
        return;
      }
      proxy.removeListener("data", onHandshake); // 必须摘除，否则后续 TLS 数据会被劫进这里
      const head = buf.subarray(0, end).toString("latin1");
      if (!/^HTTP\/1\.[01] 200/.test(head)) {
        done(() => { proxy.destroy(); reject(new Error(`代理 CONNECT 被拒（${head.split("\r\n")[0] ?? "?"}）`)); });
        return;
      }
      // 隧道就绪；TLS 由 node 走既定 CA 校验（servername 指定 SNI）
      const tlsSock = tls.connect(
        { socket: proxy, servername: t.hostname, ALPNProtocols: ["http/1.1"] },
        () => {
          const req = https.request(
            {
              // 必须走 oncreate 回调交出已握手的 TLS socket（同步 return 形式在 Node 24 https 下不生效，请求会静默挂起）
              createConnection: (_opts, oncreate): undefined => {
                oncreate(null, tlsSock);
              },
              hostname: t.hostname,
              port: 443,
              path: t.pathname + t.search,
              method: "GET",
              headers: PAGE_HEADERS,
              timeout: TRENDING_FETCH_TIMEOUT_MS,
            },
            (res) => {
              const status = res.statusCode ?? 0;
              const body: Buffer[] = [];
              res.on("data", (c: Buffer) => body.push(c));
              res.on("end", () =>
                done(() =>
                  status >= 200 && status < 300
                    ? resolve(Buffer.concat(body).toString("utf-8"))
                    : reject(new Error(`HTTP ${status}`)),
                ),
              );
              res.on("error", (e) => done(() => reject(e)));
            },
          );
          req.on("timeout", () => req.destroy(new Error("页面读取超时")));
          req.on("error", (e) => done(() => { tlsSock.destroy(); reject(e); }));
          req.end();
        },
      );
      tlsSock.on("error", (e) => done(() => reject(e)));
    };
    proxy.on("data", onHandshake);
    proxy.on("connect", () => {
      proxy.write(`CONNECT ${t.hostname}:443 HTTP/1.1\r\nHost: ${t.hostname}:443\r\n\r\n`);
    });
  });
}

/** 代理候选：显式配置优先（GITHUB_TRENDING_PROXY / HTTPS_PROXY），最后探测本地常见混合端口 */
function proxyCandidates(): string[] {
  const out: string[] = [];
  for (const key of ["GITHUB_TRENDING_PROXY", "HTTPS_PROXY", "https_proxy"]) {
    const v = process.env[key]?.trim();
    if (v && /^https?:\/\//.test(v) && !out.includes(v)) out.push(v);
  }
  const local = "http://127.0.0.1:7897"; // Clash/mihomo 默认混合端口；未监听时毫秒级拒绝、无副作用
  if (!out.includes(local)) out.push(local);
  return out;
}

/** 抓 Explore 趋势榜（默认 daily）。直连→代理多路径；全失败/空 → null（调用方降级，不抛错）。 */
export async function fetchTrendingRepos(
  since: "daily" | "weekly" | "monthly" = "daily",
): Promise<RawTrendingRepo[] | null> {
  const url = `${TRENDING_URL}?since=${since}`;
  const html = (await getHtmlDirect(url)) ?? (await getHtmlViaProxies(url));
  if (html === null) {
    console.warn("[趋势] 直连与代理均失败，本项跳过，不影响其余更新");
    return null;
  }
  const items = parseTrendingHtml(html);
  if (items.length === 0) {
    console.warn("[趋势] 页面解析为 0 条（结构可能变更），本项跳过");
    return null;
  }
  return items;
}

async function getHtmlViaProxies(url: string): Promise<string | null> {
  for (const proxyUrl of proxyCandidates()) {
    try {
      const html = await getHtmlViaProxy(proxyUrl, url);
      console.log(`[趋势] 经代理 ${proxyUrl} 抓取成功`);
      return html;
    } catch (err) {
      console.warn(`[趋势] 代理 ${proxyUrl} 失败（${(err as Error).message}）`);
    }
  }
  return null;
}
