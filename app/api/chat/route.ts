// POST /api/chat — DeepSeek 流式聊天接口
// 入参：{ "messages": [{ "role": "user"|"assistant", "content": "..." }] }
// 响应：chunked text/plain 流（只含文本增量），错误时 JSON { error }
import { NextRequest } from "next/server";
import { listDigests, readLatest } from "@/lib/data";
import { buildChatSystemPrompt, chatStream, hasDeepSeekKey } from "@/lib/deepseek";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 上游超时上限 60s */
const TIMEOUT_MS = 60_000;

export async function POST(req: NextRequest) {
  // 无 key：503 友好提示，不白屏
  if (!(await hasDeepSeekKey())) {
    return Response.json(
      { error: "未配置 AI 接入，请先到「设置」页填写接入地址与 API Key" },
      { status: 503 },
    );
  }

  // 解析入参
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const raw = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(raw)) {
    return Response.json({ error: "缺少 messages 数组" }, { status: 400 });
  }
  // 仅保留合法消息，截断最近 10 条
  const messages = raw
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        !!m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    )
    .slice(-10);
  if (messages.length === 0) {
    return Response.json({ error: "messages 不能为空" }, { status: 400 });
  }

  // 组装上下文：当日榜单 + 追踪池 delta Top 10 + 最新洞察节选（含内容安全过滤）
  const [latest, digests] = await Promise.all([readLatest(), listDigests()]);
  const system = latest
    ? await buildChatSystemPrompt(latest, digests)
    : "你是「GitHub 今日趋势」网站的 AI 助手。网站还没有生成数据，请如实告知用户，并建议其运行 node dist/cli/run-source.mjs 生成数据。";

  // 发起上游请求（在此抛错 → 正确返回 502/503）
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await chatStream(messages, system, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 502;
    const message = (err as Error)?.message ?? "上游服务异常";
    return Response.json({ error: message }, { status: status === 503 ? 503 : 502 });
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
