// GET /api/readme?repo=owner/name[&path=仓库内相对路径] — README 懒加载代理（带磁盘缓存）
// 默认 path 取仓库 README；path 给定时取仓库内指定文件（如 README.zh.md，支持 README 内部语言/文档切换）
// 缓存命中 → 直接返回 Markdown；未命中 → 现场抓取 GitHub 并写缓存
// 限流（剩余 < 8）→ 429；其他失败 → 502/404 + JSON 错误
import { NextRequest } from "next/server";
import { readReadmeCache, writeReadmeCache } from "@/lib/data";
import { getFileRaw, getReadmeRaw, isRateLimited } from "@/lib/github";

export const dynamic = "force-dynamic";

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** 仓库内相对路径：段只许字母数字 ._-，可含 / 与嵌套；拒绝绝对/回溯外逃 */
const FILE_PATH_PATTERN = /^[A-Za-z0-9_.\-/]+$/;

function okMarkdown(text: string): Response {
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get("repo") ?? "";
  if (!REPO_PATTERN.test(repo)) {
    return Response.json({ error: "repo 参数不合法，格式应为 owner/name" }, { status: 400 });
  }
  const [owner, name] = repo.split("/");

  const rawPath = req.nextUrl.searchParams.get("path") ?? "";
  // 规范化：去掉首尾斜杠/./，禁止 .. 回溯
  const filePath = rawPath.replace(/^\/+/, "").replace(/\/+$/, "").replace(/^\.\//, "");
  if (filePath && (!FILE_PATH_PATTERN.test(filePath) || filePath.includes(".."))) {
    return Response.json({ error: "path 参数不合法" }, { status: 400 });
  }

  // 1. 磁盘缓存命中 → 直接返回
  const cached = await readReadmeCache(owner, name, filePath);
  if (cached !== null) {
    return okMarkdown(cached);
  }

  // 2. 现场抓取（占核心配额），成功后写缓存
  const { content, status, remaining } = filePath
    ? await getFileRaw(owner, name, filePath)
    : await getReadmeRaw(owner, name);

  if (content !== null) {
    await writeReadmeCache(owner, name, content, filePath);
    return okMarkdown(content);
  }

  if (status === 404) {
    return Response.json(
      { error: filePath ? `仓库内找不到该文档：${filePath}` : "该仓库没有 README" },
      { status: 404 },
    );
  }
  if (isRateLimited(remaining)) {
    return Response.json(
      {
        error: `GitHub API 配额不足（剩余 ${remaining}），请稍后再试，或直接访问 GitHub 查看`,
      },
      { status: 429 },
    );
  }
  return Response.json({ error: `GitHub 接口异常（HTTP ${status}），请稍后重试` }, { status: 502 });
}
