// AI provider 接口（唯一 AI 入口，ADR A7）+ DeepSeek 门面。
// M1.4：先立接口并给 DeepSeek 门面（委托当前 lib/deepseek 实现，行为零变化）；
// deepseek 具体实现物理迁入 core/ai/ 在 M1.6 收编（届时删 lib/deepseek 垫片）。
// 接口中立：将来可插 Anthropic/OpenAI/Gemini/Ollama；provider 选择经 core/config 决定。
import { chatStream as libChatStream, completeChat as libCompleteChat, hasDeepSeekKey } from "@/lib/deepseek";

/** 流式对话消息只含 user/assistant（system 以独立参数传入，与 lib chatStream 语义一致） */
export interface StreamMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatCompleteMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatStreamOpts {
  signal?: AbortSignal;
  reasoningEffort?: string;
}

export interface ChatCompleteOpts {
  signal?: AbortSignal;
  maxTokens?: number;
  reasoningEffort?: string;
  temperature?: number;
  /** 关闭思考型模型隐藏推理（见 lib/deepseek completeChat 注释；网关不支持时自动降级） */
  disableThinking?: boolean;
}

export interface AiProvider {
  readonly name: string;
  hasKey(): Promise<boolean>;
  chatStream(
    messages: StreamMessage[],
    system: string,
    opts?: ChatStreamOpts,
  ): Promise<ReadableStream<Uint8Array>>;
  completeChat(messages: ChatCompleteMessage[], opts?: ChatCompleteOpts): Promise<string>;
}

/** DeepSeek（OpenAI 兼容）provider：委托 lib/deepseek 现实现（含 usage 计费与 400 降级） */
export function createDeepSeekProvider(): AiProvider {
  return {
    name: "deepseek",
    hasKey: () => hasDeepSeekKey(),
    chatStream: (messages, system, opts = {}) => libChatStream(messages, system, opts),
    completeChat: (messages, opts = {}) => libCompleteChat(messages, opts),
  };
}
