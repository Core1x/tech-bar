// POST /api/translate — AI 翻译（流式输出，OpenAI 兼容）
// 入参：{ "text": "...", "target": "zh" | "en" }（target 默认 zh = 简体中文）
// 响应：chunked text/plain 流（只含翻译文本增量），错误时 JSON { error }
import { NextRequest } from "next/server";
import { chatStream, hasDeepSeekKey } from "@/lib/deepseek";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 长文档翻译需要更久，放宽到 120s */
const TIMEOUT_MS = 120_000;

const TARGET_LABELS: Record<string, string> = {
  zh: "简体中文",
  en: "English",
};

export async function POST(req: NextRequest) {
  // 无 key：503 友好提示
  if (!(await hasDeepSeekKey())) {
    return Response.json(
      { error: "未配置 AI 接入，请先到「设置」页填写接入地址与 API Key" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const { text, target } = (body ?? {}) as { text?: unknown; target?: unknown };
  if (typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "缺少要翻译的文本" }, { status: 400 });
  }
  const targetLabel = TARGET_LABELS[String(target)] ?? TARGET_LABELS.zh;

  const system =
    `你是专业翻译，将用户提供的文本翻译成${targetLabel}。` +
    "要求：忠实原文、术语准确、语言自然；保留 Markdown 格式、代码块、链接与换行；" +
    "代码、命令、路径、专有名词（项目名、库名等）不翻译；只输出译文，不要添加任何解释、前后缀或「译文：」之类的标记。";

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await chatStream(
      [{ role: "user", content: text }],
      system,
      { signal: AbortSignal.timeout(TIMEOUT_MS), reasoningEffort: "low" },
    );
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 502;
    const message = (err as Error)?.message ?? "翻译服务异常";
    return Response.json({ error: message }, { status: status === 503 ? 503 : 502 });
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
