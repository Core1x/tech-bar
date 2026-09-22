// DeepSeek（OpenAI 兼容）API 封装 —— 服务端专用
// 配置来源：data/config/ai-config.json（网站在线设置）> 环境变量 > 内置默认
// 未配置 key 时所有功能优雅降级，由调用方判断
import type { LatestData } from './types';
import type { DigestMeta } from './data';
import { resolveAiConfig } from './ai-config';
import { addAiUsage } from './usage';
import { buildDeltaBlock, buildNewStarsBlock } from './prompt-blocks';
import { keywordBlocked, readSafetyKeywords } from './safety';

export { hasAiKey as hasDeepSeekKey } from './ai-config';

/**
 * 组装聊天上下文 system prompt：
 * 当日榜单 new_stars Top 20 + 追踪池 delta Top 10 + 最新一篇洞察的前 800 字
 */
export async function buildChatSystemPrompt(latest: LatestData, digests: DigestMeta[]): Promise<string> {
  // 内容安全：先把当日数据里命中过滤词（色情/NSFW 等）的仓库剔除，再排序/切片（先过滤后取 Top）
  const safety = await readSafetyKeywords();
  const cleanNewStars = latest.new_stars.filter(
    (r) => !keywordBlocked(r.full_name, r.description, r.topics, safety.keywords),
  );
  const cleanTracked = latest.tracked.filter(
    (r) => !keywordBlocked(r.full_name, r.description, r.topics, safety.keywords),
  );

  const lines: string[] = [
    '你是「GitHub 今日趋势」网站的 AI 助手，回答基于以下当天真实数据。',
    '要求：用中文回答；优先基于提供的数据；数据里没有的内容如实说明不知道；不要编造 star 数或项目信息；不要推荐内容不健康、涉色情暴力或存在虚假夸大宣传的项目。',
    '',
    `## 今日新星榜（${latest.date}，Top 20）`,
  ];

  lines.push(buildNewStarsBlock(cleanNewStars, 20));

  lines.push('', '## 追踪池近日新增 star Top 10');
  const deltaText = buildDeltaBlock(cleanTracked, 10);
  lines.push(deltaText || '（暂无数据）');

  if (digests.length > 0) {
    lines.push('', '## 最新一篇每日洞察（节选）', digests[0].content.slice(0, 800));
  }

  return lines.join('\n');
}

/**
 * 流式聊天：发起 AI 请求并返回「纯文本增量」流（chunked text/plain 可直接转发）。
 * 无 key → 抛 { status: 503 }；上游异常/非 200 → 抛 { status: 502, message: 中文错误 }。
 */
export async function chatStream(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  system: string,
  opts: { signal?: AbortSignal; reasoningEffort?: string } = {},
): Promise<ReadableStream<Uint8Array>> {
  const { baseUrl, apiKey, model } = await resolveAiConfig();
  if (!apiKey) {
    throw Object.assign(new Error('未配置 API Key，请在「设置」页填写后重试'), { status: 503 });
  }

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'system', content: system }, ...messages],
    stream: true,
    temperature: 0.7,
  };
  // 思考型模型会先流式输出大量隐藏推理（reasoning_content），再给正文。
  // 翻译这类任务不需要深推理，压低可显著缩短「无可见内容」的等待（UI 不显示推理）。
  if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;

  let res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  // 兼容降级：部分 OpenAI 兼容端点（严格网关/老模型）不认 reasoning_effort 会直接 400，
  // 去掉该参数重试一次，避免聊天/翻译整体不可用
  if (!res.ok && res.status === 400 && body.reasoning_effort) {
    delete body.reasoning_effort;
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  }

  if (!res.ok || !res.body) {
    throw Object.assign(
      new Error(`AI 接口异常（HTTP ${res.status}，${baseUrl}），请检查「设置」页的接入地址与密钥`),
      { status: 502 },
    );
  }

  // 服务端解析 SSE，只下发文本增量
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let finished = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let contentLen = 0; // 实际输出字符数，用于估算 token 用量（流式接口不返回 usage）
      // 解析 buffer 中所有「以空行结尾」的 SSE 事件（兼容 LF / CRLF），data: 开头
      const processBuffer = () => {
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        for (const event of events) {
          for (const line of event.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') {
              finished = true;
              continue;
            }
            try {
              const json = JSON.parse(payload);
              const delta: string | undefined = json.choices?.[0]?.delta?.content;
              if (delta) {
                contentLen += delta.length;
                controller.enqueue(encoder.encode(delta));
              }
            } catch {
              // 忽略残缺/非 JSON 行
            }
          }
        }
      };
      try {
        while (!finished) {
          const { done, value } = await reader.read();
          if (done) {
            finished = true;
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          processBuffer();
        }
        // 流结束：flush 残留在 buffer 里的最后一个事件（上游可能没写尾部空行）
        if (buffer.trim()) processBuffer();
      } catch (err) {
        controller.error(err);
      } finally {
        // 流式接口不返回 usage，按「输入/输出字符数 ÷ 3」估算记录（CJK/英文混合的粗略估计）
        const inputText = [system, ...messages.map((m) => m.content)].join(" ");
        void addAiUsage(Math.ceil(inputText.length / 3), Math.ceil(contentLen / 3));
        try {
          controller.close();
        } catch {
          // 流可能已出错
        }
      }
    },
  });
}

/** 非流式对话（服务端与 CLI 共用；M2 后为唯一实现） */
export async function completeChat(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  opts: {
    signal?: AbortSignal;
    maxTokens?: number;
    reasoningEffort?: string;
    temperature?: number;
    /** 彻底关闭思考型模型的隐藏推理（Qwen3/vLLM 兼容端点认 enable_thinking:false；实测本机网关提速约一倍）。
     *  与 reasoningEffort 二选一：关思考优先，不再下发 reasoning_effort。 */
    disableThinking?: boolean;
  } = {},
): Promise<string> {
  const { baseUrl, apiKey, model } = await resolveAiConfig();
  if (!apiKey) throw Object.assign(new Error('未配置 API Key'), { status: 503 });

  const body: Record<string, unknown> = { model, messages, stream: false, temperature: opts.temperature ?? 0.7 };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  // 非流式调用等待完整输出：关思考（enable_thinking=false）最快；端点不认时按 400 降级为降低推理强度
  if (opts.disableThinking) body.enable_thinking = false;
  else if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;
  // 推理模型偶发「只出推理不出正文」，空内容时重试一次
  for (let attempt = 0; attempt < 2; attempt++) {
    let res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    // 兼容降级：部分 OpenAI 兼容端点不认思考控制参数会 400 → 去掉重试一次；
    // 调用方若同时给了 reasoningEffort（关不了思考时至少压低推理），降级请求里补上
    if (!res.ok && res.status === 400 && ('enable_thinking' in body || body.reasoning_effort)) {
      const wantedEffort = 'enable_thinking' in body ? opts.reasoningEffort : undefined;
      delete body.enable_thinking;
      delete body.reasoning_effort;
      if (wantedEffort) body.reasoning_effort = wantedEffort;
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    }
    if (!res.ok) {
      throw Object.assign(new Error(`AI 接口异常（HTTP ${res.status}）`), { status: 502 });
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content ?? '';
    if (content) {
      // 记录精确 token 用量（非流式接口返回 usage）
      if (json.usage) {
        void addAiUsage(json.usage.prompt_tokens ?? 0, json.usage.completion_tokens ?? 0);
      }
      return content;
    }
  }
  throw new Error('AI 返回空内容');
}
