// 中文需求 → 英文 GitHub 查询词的**内置同义映射**（兜底 + 扩展）。
// 背景（2026-09-09 实测）：AI 转译 GitHub 查询词不稳定（可能返回中文原文，中文直搜英文索引命中几乎为 0，
// 如「开源播放器」直搜只返回无关书/字典，知名项目 Kodi 完全不可见）。因此除 AI 生成外，这里提供一份
// **确定性的常见技术词 → 英文同义词表**，命中即扩展出多路英文查询，覆盖 Kodi 这类「描述含 media center」的项目。
// 本表是"最小可用"集合，可按需扩充；纯函数、零依赖、可单测。

type SynonymRule = { re: RegExp; words: string[] };

const RULES: SynonymRule[] = [
  { re: /播放器|媒体中心|播放|影音|player|media/i, words: ["player", "media center", "video player", "media player"] },
  { re: /编辑器|edit/i, words: ["editor", "code editor"] },
  { re: /爬虫|抓取|scrap|crawl/i, words: ["crawler", "scraper", "web scraper"] },
  { re: /下载|download/i, words: ["downloader", "download manager"] },
  { re: /终端|命令行|shell|terminal/i, words: ["terminal", "cli", "shell", "terminal emulator"] },
  { re: /AI|人工智能|智能体|代理|agent|大模型|llm/i, words: ["ai", "llm", "agent", "ai agent"] },
  { re: /数据库|database|db/i, words: ["database", "orm"] },
  { re: /前端|web|网页|frontend/i, words: ["frontend", "web", "react", "vue"] },
  { re: /后端|服务端|backend/i, words: ["backend", "server", "api"] },
  { re: /框架|framework/i, words: ["framework"] },
  { re: /工具|utility|tool/i, words: ["tool", "cli", "utility"] },
  { re: /监控|可观测|monitor|observ/i, words: ["monitoring", "observability", "metrics"] },
  { re: /聊天|消息|chat|messag/i, words: ["chat", "chatbot", "messaging"] },
  { re: /照片|图片|图像|image|photo/i, words: ["image", "photo", "computer-vision"] },
  { re: /加密|安全|security|crypt/i, words: ["security", "cryptography"] },
  { re: /git|代码托管|版本控制/i, words: ["git", "version control"] },
  { re: /注音|朗读|语音|tts|speech|voice/i, words: ["tts", "speech", "voice"] },
  { re: /笔记|note|markdown/i, words: ["notes", "markdown", "notebook"] },
  { re: /窗口|桌面|desktop|gui/i, words: ["desktop", "gui", "cross-platform"] },
];

/**
 * 把中文需求扩展出若干英文查询词（去重、去空、限 ≤6）。
 * 命中多条规则则合并其 words（同义词并集，交回多路搜索）；一条不命中 → 返回 []（调用方回退采用 AI/原文）。
 */
export function expandChineseQuery(zh: string): string[] {
  const out: string[] = [];
  for (const { re, words } of RULES) {
    if (re.test(zh)) for (const w of words) out.push(w);
  }
  return [...new Set(out)].slice(0, 6);
}
