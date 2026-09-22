// M4（§10.2）：从 AI 生成的 Markdown 正文中提取「被点名的 GitHub 仓库」。
// 只认结构可信的位置（保守防误报）：github.com/o/r 链接、`code`/加粗 **、[] 链接文本里的 owner/repo 记号；
// 排除常见伪仓库（路径 docs/…、带文件后缀、停用词）。纯函数、零 I/O，供渲染与行动区与单测复用。

const TOKEN = "[A-Za-z0-9][A-Za-z0-9_.-]*";
const OWNER_STOP = new Set(["docs", "src", "www", "http", "https", "and", "or", "n", "e", "g", "etc", "vs"]);
const FILE_EXT_RE = /\.(md|markdown|json|jsonc|ya?ml|toml|txt|html?|css|scss|less|png|jpe?g|gif|svg|webp|ico|js|mjs|cjs|jsx|ts|tsx|py|go|rs|rb|java|kt|swift|c|h|cpp|cc|cs|sh|bash|ps1|bat|lock|csv|xml|ini|env|gitignore|dockerfile|log)$/i;

function plausible(fullName: string): boolean {
  const m = fullName.match(new RegExp(`^(${TOKEN})\\/(${TOKEN})$`));
  if (!m) return false;
  const [, owner, name] = m;
  if (owner.length > 39 || name.length === 0) return false;
  if (OWNER_STOP.has(owner.toLowerCase())) return false;
  if (FILE_EXT_RE.test(name) || name.includes("..") || owner.includes("..")) return false;
  // 纯日期/版本号样式不像仓库
  if (/^\d/.test(name) && /^[\d.\-_]+$/.test(name)) return false;
  return true;
}

/**
 * 提取正文中被点名的仓库（保序去重，≤limit）。
 * 匹配来源：
 *  1. markdown 链接文本 `[owner/repo](...)` 或链接指向 github.com/o/r；
 *  2. 反引号 `owner/repo`；
 *  3. 加粗 **owner/repo**（含列表项常用 `- **owner/repo**` 样式）。
 */
export function extractRepoRefs(md: string, limit = 12): string[] {
  // 先收集「位置 + 记号」再按正文出现顺序输出（多正则分轮扫描会打乱文本序）
  const found: Array<{ pos: number; tok: string }> = [];
  const collect = (re: RegExp, pick: (m: RegExpExecArray) => string | undefined) => {
    for (const m of md.matchAll(re)) {
      const tok = pick(m);
      if (tok) found.push({ pos: m.index ?? 0, tok: tok.trim().replace(/^@/, "") });
    }
  };

  // 1) github.com/o/r 链接（允许带后缀路径，取前两段）
  collect(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g, (m) => `${m[1]}/${m[2]}`);
  // 2) 链接文本 / 行内代码 / 加粗 里的记号
  collect(/\[([^\]\n]+)\]\([^)\n]*\)/g, (m) => m[1]);
  collect(/`([^\s`]+)`/g, (m) => m[1]);
  collect(/\*\*([^\s*]+)\*\*/g, (m) => m[1]);

  found.sort((a, b) => a.pos - b.pos);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { tok } of found) {
    if (!plausible(tok) || seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 把正文里「裸提及」的仓库补成站内链接（§10.2）：
 * `**o/r**` → `**[o/r](/repo/o/r)**`；行内代码 `o/r` → [`o/r`](/repo/o/r)；
 * 已是链接/图片的一部分不重复包装（用否定预查跳过紧随 `](` 或前置 `[` 的记号）。
 */
export function linkifyRepoMentions(md: string): string {
  // 加粗记号：`**o/r**`（前非 `[`、后非 `]`，跳过已是链接文本的情形）
  let out = md.replace(
    /(?<!\[)\*\*([\w.\-]+\/[\w.\-]+)\*\*(?!\])/g,
    (whole, tok: string) => (plausible(tok) ? `**[${tok}](/repo/${tok})**` : whole),
  );
  // 行内代码记号：`` `o/r` `` → 带代码样式的站内链接
  out = out.replace(
    /(?<!\[)`([\w.\-]+\/[\w.\-]+)`(?!\]\()/g,
    (whole, tok: string) => (plausible(tok) ? "[`" + tok + "`](/repo/" + tok + ")" : whole),
  );
  return out;
}
