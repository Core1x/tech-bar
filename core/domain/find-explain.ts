// M5 §11.1：AI 寻找结果的「为什么匹配」——字段级、确定性解释（可核实，不让 AI 编造匹配理由）。
// 输入是搜索时已知的信息：各路查询词、命中路数、仓库字段；输出 ≤3 条命中的字段事实。零 I/O。

export interface FindExplainRepo {
  full_name: string;
  description: string | null;
  topics: string[];
  language: string | null;
}

/** 从查询串提取可匹配词：拉丁词（含 -/.）、CJK 短语段；全小写、去停用词 */
const LATIN_STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "your", "you", "are", "was", "using", "based", "into", "open", "source", "github", "simple", "fast", "modern", "easy", "tool", "tools", "app", "project", "library", "framework", "support", "build", "built", "make", "made", "find", "search", "top", "best"]);

export function queryTermsOf(...queries: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const q of queries) {
    if (!q) continue;
    const text = q.toLowerCase();
    for (const m of text.matchAll(/[a-z0-9][a-z0-9._+-]{1,}/g)) {
      const t = m[0].replace(/^(?:topic|language|stars|created|repo|user|org):/, "");
      if (t.length >= 2 && !LATIN_STOP.has(t)) out.add(t);
    }
    // 中文短语：取 2 字以上的连续 CJK 段（用于描述/名称的包含式匹配）
    for (const m of text.matchAll(/[㐀-䶿一-鿿]{2,}/g)) out.add(m[0]);
  }
  return [...out];
}

/**
 * 生成匹配解释（≤3 条）：话题命中 > 名称/描述命中 > 语言匹配 > 多路命中；全无 → 「关键词搜索命中」兜底。
 */
export function explainRepoMatch(
  repo: FindExplainRepo,
  terms: string[],
  hits: number | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => {
    if (!seen.has(s) && out.length < 3) {
      seen.add(s);
      out.push(s);
    }
  };
  const topicsLower = repo.topics.map((t) => t.toLowerCase());
  const desc = (repo.description ?? "").toLowerCase();
  const nameLower = repo.full_name.toLowerCase();

  for (const t of terms) {
    const topicHit = topicsLower.find((tp) => tp === t || tp.includes(t) || t.includes(tp));
    if (topicHit) add(`话题命中「${topicHit}」`);
  }
  // 描述/名称用「包含式」匹配：仅对 ≥3 字符的词启用（防 to/of 等短词误命中子串）
  for (const t of terms) {
    if (out.length >= 3) break;
    if (t.length >= 3 || /[㐀-鿿]/.test(t)) {
      if (desc.includes(t)) {
        add(`描述命中「${t}」`);
        break;
      }
      if (nameLower.includes(t) && !topicsLower.some((tp) => tp.includes(t))) {
        add(`名称含「${t}」`);
        break;
      }
    }
  }
  if (repo.language && terms.includes(repo.language.toLowerCase())) add(`语言为 ${repo.language}`);
  if ((hits ?? 0) >= 2) add(`被 ${hits} 路查询同时命中`);
  if (out.length === 0) out.push("关键词搜索命中（未匹配到具体字段）");
  return out;
}
