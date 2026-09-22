// AI 长文（每日洞察 / 趋势周报）统一渲染器（M4 §10.2）：
// - 正文里点名 GitHub 仓库的「裸记号」（**o/r**、`o/r`）自动补站内详情链接（linkifyRepoMentions）；
// - github.com/o/r 外链改指站内详情页（详情页自带 GitHub 外链出口，信息不丢失；
//   tree/blob/issues/releases/topics 等深链保持外跳）；其余外链新标签打开。
import Link from "next/link";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { linkifyRepoMentions } from "@/core/domain/repo-refs";

const REPO_URL_RE = /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/;
const DEEP_LINK_RE = /^https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(tree|blob|issues|pulls?|releases|tags|discussions|actions|security|stargazers|forks|network)(\/|$)/;
const OWNER_STOP = new Set(["github", "features", "topics", "collections", "sponsors", "settings", "marketplace"]);

function MdLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  if (typeof href === "string") {
    if (DEEP_LINK_RE.test(href)) {
      return (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      );
    }
    const m = href.match(REPO_URL_RE);
    if (m && !OWNER_STOP.has(m[1])) {
      return (
        <Link href={`/repo/${m[1]}/${m[2]}`} title="查看站内详情（含决策卡与 README）">
          {children}
        </Link>
      );
    }
    if (/^https?:\/\//.test(href)) {
      return (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      );
    }
  }
  return <a href={href}>{children}</a>;
}

export function DigestMarkdown({ source }: { source: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: MdLink }}>
      {linkifyRepoMentions(source)}
    </ReactMarkdown>
  );
}
