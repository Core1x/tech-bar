// 跨源去重的规范化纯函数（docs/architecture.md §4.10 backlog ①：确定性归一）。
// 目标：把「同一技术/仓库」在不同源的条目归一到同一 canonical subject key，从而聚成一条叙事（groupId）。
// 两级命中：① URL/host+path 归一（GitHub html_url 与 HN 外链同 repo 时命中）；② 标题归一兜底。
// LLM 聚类（backlog ②）不在本次。本模块纯函数、零依赖、零 I/O（domain 层）。

/** 剥离 URL 的 query/hash，去尾斜杠、归一 host 小写；github.com/owner/repo 特归一为 full_name */
export function canonicalUrlKey(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // 非合法 URL：直接小写去空白兜底
    return raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 256);
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  // GitHub 仓库页 → 归一到 `${owner}/${repo}`（去 .git/.tree/…）。host 判 github.com 即可（含 githubusercontent 站外）
  if (host === "github.com") {
    const seg = path.split("/").filter(Boolean);
    if (seg.length >= 2) return `${seg[0]}/${seg[1].replace(/\.git$/, "")}`;
  }
  return `${host}${path === "/" ? "" : path}`;
}

/** 标题归一：小写、折叠空白、剥离方括号/圆括号后缀（如 " [video]"、"(YC S25)"） */
export function canonicalTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*[\[(（][^\]\[)）]{0,40}[\]\])）]\s*$/g, "") // 尾部 [..]/(..)/(..)
    .replace(/\s*[\[(（].+?[\]\])）]\s*$/g, "")
    .trim()
    .slice(0, 256);
}

/**
 * 生成跨源去重用的 canonical subject key。
 * 优先 URL（GitHub↔HN 同 repo 命中，如 github.com/o/r 与 HN 外链同 URL）；URL 无信息时用标题归一。
 * 返回 string；无 URL 且无标题时可返回 null（不参与分簇，各自独立）。
 */
export function canonicalSubjectKey(entry: { url?: string | null; title?: string | null }): string | null {
  const url = entry.url?.trim();
  if (url) {
    const u = canonicalUrlKey(url);
    // host 有实际主机名才算有效 URL 键（news.ycombinator.com/item?id= 这类应走标题兜底）
    if (u && !u.startsWith("news.ycombinator.com")) return `u:${u}`;
  }
  const title = entry.title?.trim();
  if (title) return `t:${canonicalTitle(title)}`;
  return null;
}
