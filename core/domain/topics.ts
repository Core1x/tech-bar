// 话题工具：判定"具体话题"（非语言/非包络词），供同类匹配与主题热度聚合共用，避免多份漂移。
// M1.2 由 lib/topics.ts 迁入；lib/topics.ts 现为 re-export 垫片。
// 原则：过泛/跨域话题单凭它判不了"需求/生态"——不算 overlap，也不作热度主信号（保守，宁漏不误）。
// 供应商/生态话题（dsh、dsh-plugin、claude、deepseek、cordis…）保留为具体。

export const GENERIC_TOPICS = new Set<string>([
  // 领域/技术栈大类（纯语言 ≠ 需求）
  "ai", "artificial-intelligence", "llm", "large-language-models", "machine-learning", "deep-learning",
  "ml", "nlp", "python", "javascript", "typescript", "rust", "go", "golang", "java", "c", "cpp", "c++",
  "csharp", "kotlin", "swift", "ruby", "php", "scala", "dart", "zig", "shell", "webassembly",
  // 无信息量包络词
  "library", "libraries", "framework", "frameworks", "toolkit", "tool", "tools", "utility", "utilities",
  "utils", "developer-tools", "devtools", "hacktoberfest", "open-source", "opensource", "awesome",
  "awesome-list", "api", "cli", "command-line", "terminal", "web", "webapp", "website", "app",
  "application", "apps", "desktop", "desktop-app", "bot", "demo", "example", "examples", "plugin",
  "plugins", "extension", "extensions", "frontend", "backend", "cross-platform", "learning", "tutorial",
  "docs", "documentation", "template", "starter", "boilerplate", "config", "configuration", "ui",
  "component", "components", "self-hosted",
]);

/** 过滤出"具体话题"（非停用词且长度 ≥3） */
export function specificTopics(topics: string[] = []): string[] {
  return topics.filter((x) => !GENERIC_TOPICS.has(x) && x.length >= 3);
}

/** 与本仓库共享的「具体话题」数（candidate 只共享泛词如 ai/python → 0） */
export function topicOverlap(currentTopics: string[], candidateTopics: string[] = []): number {
  const cur = specificTopics(currentTopics);
  const cand = new Set(candidateTopics);
  return cur.filter((t) => cand.has(t)).length;
}
