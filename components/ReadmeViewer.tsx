// 详情页 README 懒加载渲染：调 /api/readme，react-markdown + remark-gfm
// - rehype-raw：把 README 里的原生 HTML（hero 图/徽章等）当元素渲染（GitHub 同款），不再露标签文本
// - rehypeAbsolutize：把相对路径素材（assets/x.png 等）解析到 raw.githubusercontent.com 默认分支
// - rehype-sanitize：渲染原始 HTML 前按 GitHub 风格白名单消毒，防注入
// - 仓库内文档切换：README 顶部「English | [中文](README.zh.md)」这类相对 .md 链接 → 页内加载对应文档
// - 「原文 / AI 翻译」切换走 /api/translate 流式；限流/失败时显示友好提示 + GitHub 链接，不白屏
"use client";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

type LoadState = "loading" | "ready" | "error";
type View = "original" | "translated";

// ---------- 仓库内路径工具（供素材解析 + 页内文档切换共用） ----------

/** 把仓库内相对路径按当前文档目录归并，禁止越出仓库根（.. 超出即丢弃该层） */
function normalizeRepoPath(baseDir: string, rel: string): string {
  const parts = (baseDir ? baseDir.split("/") : []).filter(Boolean);
  for (const seg of rel.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

function dirOf(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i < 0 ? "" : filePath.slice(0, i);
}

/** 是否为"仓库内另一份 Markdown 文档"的相对链接（README 语言切换/目录链） */
function isInternalDocLink(href: string): boolean {
  const clean = href.split("#")[0].split("?")[0];
  return /\.md$/i.test(clean) && clean.length > 0;
}

/**
 * react-markdown 会把 HTML 遗留属性按 JSX property 转成驼峰（valign→vAlign），
 * React DOM 不认这类驼峰非标准属性会报警。这些属性只影响表格/图片对齐，直接剥掉更稳。
 */
const DROP_ATTRS = new Set(["valign", "halign", "bgcolor", "background", "nowrap", "charoff", "cellspacing", "cellpadding"]);

function isRelativeUrl(u: string): boolean {
  return !/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(u);
}

// ---------- rehype 插件：相对素材/链接 → GitHub 绝对地址 ----------

interface AbsOpts {
  owner: string;
  name: string;
  baseDir: string;
}

interface HastNode {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: unknown[];
}

function walkHast(node: unknown, cb: (n: HastNode) => void): void {
  if (!node || typeof node !== "object") return;
  cb(node as HastNode);
  const children = (node as HastNode).children;
  if (Array.isArray(children)) for (const c of children) walkHast(c, cb);
}

function rehypeAbsolutize(opts: AbsOpts) {
  const rawPrefix = `https://raw.githubusercontent.com/${opts.owner}/${opts.name}/HEAD/`;
  const blobPrefix = `https://github.com/${opts.owner}/${opts.name}/blob/HEAD/`;
  return (tree: unknown): void => {
    walkHast(tree, (n) => {
      if (n.type !== "element") return;
      const props = n.properties ?? {};
      // 剥掉 React 不认的遗留 HTML 属性（valign/vAlign 等），避免控制台警告
      for (const k of Object.keys(props)) {
        if (DROP_ATTRS.has(String(k).toLowerCase())) delete props[k];
      }
      // 图片：相对 src → raw.githubusercontent（默认分支 HEAD）
      if (n.tagName === "img" && typeof props.src === "string" && isRelativeUrl(props.src)) {
        props.src = rawPrefix + normalizeRepoPath(opts.baseDir, props.src);
      }
      // 链接：相对且非"仓库内 .md 文档" → blob（.md 文档留给页内切换处理）
      if (
        n.tagName === "a" &&
        typeof props.href === "string" &&
        isRelativeUrl(props.href) &&
        !isInternalDocLink(props.href)
      ) {
        props.href = blobPrefix + normalizeRepoPath(opts.baseDir, props.href);
      }
    });
  };
}

export function ReadmeViewer({ repo, htmlUrl }: { repo: string; htmlUrl: string }) {
  const [owner, name] = repo.split("/");
  const [state, setState] = useState<LoadState>("loading");
  const [content, setContent] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [view, setView] = useState<View>("original");
  const [translating, setTranslating] = useState(false);
  const [translated, setTranslated] = useState("");
  const [transError, setTransError] = useState<string | null>(null);
  /** 当前展示的仓库内文档路径（''=仓库根 README；'README.zh.md' 等） */
  const [docPath, setDocPath] = useState("");

  /** 拉取指定仓库内文档（''=默认 README），统一处理加载/错误 */
  async function loadDoc(filePath: string) {
    setState("loading");
    setView("original");
    setTranslated("");
    setTransError(null);
    setDocPath(filePath);
    try {
      const qs = filePath ? `&path=${encodeURIComponent(filePath)}` : "";
      const res = await fetch(`/api/readme?repo=${encodeURIComponent(repo)}${qs}`);
      if (res.ok) {
        const text = await res.text();
        setContent(text);
        setState("ready");
      } else {
        let msg = `加载失败（HTTP ${res.status}）`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          // 非 JSON 错误体
        }
        setErrorMsg(msg);
        setState("error");
      }
    } catch {
      setErrorMsg("网络异常，请稍后重试");
      setState("error");
    }
  }

  // 仓库切换时由父组件通过 key 重挂载（初始即 loading），此处加载根 README
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/readme?repo=${encodeURIComponent(repo)}`);
        if (res.ok) {
          const text = await res.text();
          if (!cancelled) {
            setContent(text);
            setState("ready");
          }
        } else {
          let msg = `README 加载失败（HTTP ${res.status}）`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j?.error) msg = j.error;
          } catch {
            // 非 JSON 错误体
          }
          if (!cancelled) {
            setErrorMsg(msg);
            setState("error");
          }
        }
      } catch {
        if (!cancelled) {
          setErrorMsg("网络异常，请稍后重试");
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo]);

  // AI 翻译当前文档（流式累积）
  async function translate() {
    if (translating || !content.trim()) return;
    setTranslating(true);
    setTransError(null);
    setTranslated("");
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content, target: "zh" }),
      });
      if (!res.ok) {
        let msg = `翻译失败（HTTP ${res.status}）`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          // 非 JSON
        }
        setTransError(msg);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setTransError("无法读取翻译流");
        return;
      }
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setTranslated((prev) => prev + chunk);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setTransError("网络异常，请稍后重试");
      }
    } finally {
      setTranslating(false);
    }
  }

  function switchView(next: View) {
    setView(next);
    if (next === "translated" && !translated && !transError && !translating) {
      void translate();
    }
  }

  /** 仓库内文档切换 + 外链体验：.md 相对链 → 页内加载；其余外链 → 新标签打开，不让本页跳走 */
  function handleContentClick(e: MouseEvent<HTMLDivElement>) {
    const el = e.target as Element | null;
    const a = el?.closest?.("a");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href) return;

    if (href.startsWith("#")) return; // 页内锚点，交给浏览器
    if (/^mailto:|^tel:/.test(href)) return; // 非链接协议，默认

    // 仓库内 .md 文档链接 → 页内加载对应文档
    if (isRelativeUrl(href) && isInternalDocLink(href)) {
      e.preventDefault();
      const p = normalizeRepoPath(dirOf(docPath), href);
      if (p && p !== docPath) void loadDoc(p);
      return;
    }
    // 其余链接一律新标签打开（相对非 .md 已被插件改成 github blob 绝对地址）
    e.preventDefault();
    const abs = isRelativeUrl(href) ? `https://github.com/${owner}/${name}/blob/HEAD/${normalizeRepoPath(dirOf(docPath), href)}` : href;
    window.open(abs, "_blank", "noopener,noreferrer");
  }

  if (state === "loading") {
    return (
      <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-6 text-sm text-[#8b949e]">
        正在加载 {docPath || "README"}…
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="rounded-lg border border-[#f85149]/40 bg-[#f85149]/10 p-6">
        <p className="text-sm text-[#f85149]">{errorMsg}</p>
        <a
          href={htmlUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 inline-block text-sm text-[#58a6ff] hover:underline"
        >
          在 GitHub 上查看 →
        </a>
      </div>
    );
  }

  if (!content.trim()) {
    return <p className="text-sm text-[#8b949e]">该仓库没有 README 内容</p>;
  }

  // 渲染 markdown 的 rehype 插件：raw HTML + 素材绝对化 + 消毒（GitHub 风格白名单）
  const renderMarkdown = (md: string): ReactNode => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[
        rehypeRaw,
        [rehypeAbsolutize, { owner, name, baseDir: dirOf(docPath) }],
        rehypeSanitize,
      ]}
    >
      {md}
    </ReactMarkdown>
  );

  return (
    <div className="overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22]">
      {/* 原文 / AI 翻译 切换 */}
      <div className="flex items-center gap-1 border-b border-[#21262d] bg-[#0d1117] px-3 py-2">
        <button
          onClick={() => switchView("original")}
          className={`rounded px-2.5 py-1 text-xs transition-colors ${
            view === "original" ? "bg-[#21262d] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"
          }`}
        >
          原文
        </button>
        <button
          onClick={() => switchView("translated")}
          disabled={translating}
          className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors disabled:opacity-60 ${
            view === "translated" ? "bg-[#1f6feb] text-white" : "bg-[#1f6feb]/15 text-[#58a6ff] hover:text-[#e6edf3]"
          }`}
        >
          {translating && (
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
              <path d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
          {translating ? "翻译中…" : "AI 翻译"}
        </button>
        {view === "translated" && translated && (
          <button
            onClick={() => setView("original")}
            className="ml-auto text-xs text-[#8b949e] transition-colors hover:text-[#e6edf3]"
          >
            返回原文
          </button>
        )}
        {docPath && (
          <span className="ml-auto flex min-w-0 items-center gap-2 text-xs text-[#8b949e]">
            <span className="truncate">{docPath}</span>
            <button
              onClick={() => void loadDoc("")}
              className="shrink-0 rounded border border-[#30363d] px-1.5 py-0.5 text-[#58a6ff] transition-colors hover:border-[#58a6ff]"
            >
              ← 返回 README
            </button>
          </span>
        )}
      </div>

      {transError && (
        <div className="border-b border-[#f85149]/40 bg-[#f85149]/10 px-4 py-2 text-sm text-[#f85149]">
          {transError}
        </div>
      )}

      {/* 内容 */}
      <div className="markdown-body p-6" onClick={handleContentClick}>
        {view === "translated" ? (
          translated ? (
            renderMarkdown(translated)
          ) : (
            <p className="text-sm text-[#8b949e]">正在翻译…（长文档可能需要一些时间）</p>
          )
        ) : (
          renderMarkdown(content)
        )}
      </div>
    </div>
  );
}
