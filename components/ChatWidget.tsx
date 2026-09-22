// 全站右下角浮动聊天窗：流式输出，消息历史仅存内存（刷新清空）
// 与「AI 翻译」按钮横向并列、互斥：打开一个自动关闭另一个
"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getActiveWidget, setActiveWidget, subscribeFloating } from "@/lib/floating-store";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "今天有什么值得关注的 AI 项目？",
  "帮我对比榜单前 3 个项目",
  "最近 Rust 圈有什么新星？",
];

export default function ChatWidget() {
  // 第三个参数是服务端渲染快照：SSR 阶段恒为 null（面板关闭）
  const active = useSyncExternalStore(subscribeFloating, getActiveWidget, () => null);
  const open = active === "chat";
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 新消息到达自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;

    const history: Msg[] = [...messages, { role: "user", content }];
    setMessages(history);
    setInput("");
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok) {
        let msg = `请求失败（HTTP ${res.status}）`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          // 响应体不是 JSON 时用默认提示
        }
        setError(msg);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("无法读取响应流");
        return;
      }

      const decoder = new TextDecoder();
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // 函数式更新累积到最后一个助手消息上，避免局部可变变量（React Compiler 不可变规则）
        setMessages((prev) => {
          const rest = prev.slice(0, -1);
          const last = prev[prev.length - 1];
          const prevContent = last?.role === "assistant" ? last.content : "";
          return [...rest, { role: "assistant", content: prevContent + chunk }];
        });
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError("网络异常，请稍后重试");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* 浮动按钮（右下角，翻译按钮在其左侧） */}
      <button
        onClick={() => {
          const next = open ? null : "chat";
          setActiveWidget(next);
          if (next === "chat") setTimeout(() => inputRef.current?.focus(), 50);
        }}
        aria-label="打开 AI 聊天"
        className="fixed bottom-5 right-5 z-50 flex items-center justify-center rounded-full bg-[#238636] text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
        style={{ height: 52, width: 52 }}
      >
        {open ? (
          <svg className="h-6 w-6" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
          </svg>
        ) : (
          <svg className="h-6 w-6" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M8 1.5a5.5 5.5 0 0 1 5.5 5.5c0 2.2-1.3 4.1-3.2 5H5.7a5.7 5.7 0 0 1-.2-.1l-.7 1.6c.4-.1.8 0 1 .3.1.3 0 .6-.3.8l-1.9 1c-.3.1-.6 0-.7-.3l.5-.9c-.4-.2-.7-.4-1-.7l-.4.8c-.2.3-.5.4-.8.2L.4 14.2c-.3-.2-.3-.5-.1-.8l1-1.9c.1-.3.4-.4.8-.3.2.1.3.4.2.7l-.4.9.3.1c.4.1.8-.1.9-.5l.2-.9c.4-.7 1-1.3 1.7-1.7C5.5 6.5 6.6 6.4 8 6.4V1.5ZM6.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm3 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
          </svg>
        )}
      </button>

      {/* 面板 */}
      {open && (
        <div className="fixed bottom-20 right-5 z-50 flex h-[min(70vh,620px)] w-[560px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22] shadow-2xl">
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-[#21262d] bg-[#0d1117] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[#e6edf3]">AI 助手</p>
              <p className="text-xs text-[#8b949e]">基于当日榜单真实数据回答</p>
            </div>
            <Link
              href="/settings"
              title="AI 接入设置"
              className="text-[#8b949e] transition-colors hover:text-[#58a6ff]"
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
                <path d="M8 1.25c-.458 0-.916.066-1.357.198l-.132.04a2 2 0 0 0-1.478 1.29l-.346.944a.25.25 0 0 1-.26.17l-1.003-.07a2 2 0 0 0-1.766.928l-.5.867a2 2 0 0 0 .207 2.22l.66.766a.25.25 0 0 1 0 .304l-.66.766a2 2 0 0 0-.207 2.22l.5.867a2 2 0 0 0 1.766.928l1.003-.07a.25.25 0 0 1 .26.17l.346.944a2 2 0 0 0 1.478 1.29l.132.04a4.06 4.06 0 0 0 2.714 0l.132-.04a2 2 0 0 0 1.478-1.29l.346-.944a.25.25 0 0 1 .26-.17l1.003.07a2 2 0 0 0 1.766-.928l.5-.867a2 2 0 0 0-.207-2.22l-.66-.766a.25.25 0 0 1 0-.304l.66-.766a2 2 0 0 0 .207-2.22l-.5-.867a2 2 0 0 0-1.766-.928l-1.003.07a.25.25 0 0 1-.26-.17l-.346-.944a2 2 0 0 0-1.478-1.29l-.132-.04A4.06 4.06 0 0 0 8 1.25Zm0 7.5a2.75 2.75 0 1 1 0-5.5 2.75 2.75 0 0 1 0 5.5Z" />
              </svg>
            </Link>
          </div>

          {/* 消息区 */}
          <div ref={scrollRef} className="chat-scroll flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
            {messages.length === 0 ? (
              <div>
                <p className="mb-3 text-sm text-[#8b949e]">
                  你好！我可以基于当日 GitHub 榜单回答你的问题。
                </p>
                <div className="space-y-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      disabled={busy}
                      className="block w-full rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-2 text-left text-sm text-[#58a6ff] transition-colors hover:border-[#58a6ff] disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "ml-auto bg-[#238636] text-white"
                      : "bg-[#21262d] text-[#e6edf3]"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <div className="markdown-body-chat">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || "…"}</ReactMarkdown>
                    </div>
                  ) : (
                    m.content
                  )}
                </div>
              ))
            )}
            {busy && (
              <div className="max-w-[90%] rounded-lg bg-[#21262d] px-3 py-2 text-sm text-[#8b949e]">
                <span className="animate-pulse">思考中…</span>
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-[#f85149]/40 bg-[#f85149]/10 px-3 py-2 text-sm text-[#f85149]">
                {error}
              </div>
            )}
          </div>

          {/* 输入区 */}
          <div className="border-t border-[#21262d] p-3">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="问点什么…（Enter 发送）"
                disabled={busy}
                className="flex-1 rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3] placeholder-[#8b949e] outline-none transition-colors focus:border-[#58a6ff] disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="rounded-md bg-[#238636] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2ea043] disabled:opacity-50"
              >
                发送
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
