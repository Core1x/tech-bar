// 全站右下角常驻 AI 翻译窗：粘贴英文文本 → 流式翻译成中文。
// 与「AI 问答」按钮横向并列、互斥：打开一个自动关闭另一个。
// 小屏隐藏浮动翻译入口（§12.4 减少双按钮遮挡；README 页内已有「AI 翻译」按钮，功能不断链）。
"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getActiveWidget, setActiveWidget, subscribeFloating } from "@/lib/floating-store";

const TARGETS = [
  { value: "zh", label: "简体中文" },
  { value: "en", label: "English" },
];

export default function TranslateWidget() {
  // 第三个参数是服务端渲染快照：SSR 阶段恒为 null（面板关闭）
  const active = useSyncExternalStore(subscribeFloating, getActiveWidget, () => null);
  const open = active === "translate";
  const [input, setInput] = useState("");
  const [target, setTarget] = useState("zh");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // 翻译输出自动滚到底
  useEffect(() => {
    const el = resultRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [result, busy]);

  async function translate() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setResult("");
    setError(null);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, target }),
      });
      if (!res.ok) {
        let msg = `翻译失败（HTTP ${res.status}）`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          // 非 JSON
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
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // 函数式累积，避免局部可变变量（React Compiler 不可变规则）
        setResult((prev) => prev + chunk);
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
      {/* 常驻翻译按钮（右下角，问答按钮左侧横向并列） */}
      <button
        onClick={() => {
          const next = open ? null : "translate";
          setActiveWidget(next);
          if (next === "translate") setTimeout(() => inputRef.current?.focus(), 50);
        }}
        aria-label="打开 AI 翻译"
        title="AI 翻译"
        className="fixed bottom-5 right-[4.75rem] z-50 hidden items-center justify-center rounded-full bg-[#1f6feb] text-white shadow-lg transition-transform hover:scale-105 active:scale-95 md:flex"
        style={{ height: 52, width: 52 }}
      >
        {open ? (
          <svg className="h-6 w-6" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
          </svg>
        ) : (
          <svg className="h-6 w-6" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M4 1.75A2.75 2.75 0 0 0 1.25 4.5v4a2.75 2.75 0 0 0 2.75 2.75h.31l2.72 2.72c.9.9 2.45.26 2.45-1.01v-1.71h.07a2.75 2.75 0 0 0 2.75-2.75v-4A2.75 2.75 0 0 0 11.8 1.75H4Zm8 1.5c.69 0 1.25.56 1.25 1.25v4c0 .69-.56 1.25-1.25 1.25h-1.35a.75.75 0 0 0-.53.22l-1.87 1.87v-1.6a.75.75 0 0 0-.75-.75H4c-.69 0-1.25-.56-1.25-1.25v-4c0-.69.56-1.25 1.25-1.25h8ZM5 4.75c-.41 0-.75.34-.75.75S4.59 6.25 5 6.25h4a.75.75 0 0 0 0-1.5H5Zm0 2.5c-.41 0-.75.34-.75.75s.34.75.75.75h2.25a.75.75 0 0 0 0-1.5H5Z" />
          </svg>
        )}
      </button>

      {/* 翻译面板（与问答面板同位置，互斥不会同时出现） */}
      {open && (
        <div className="fixed bottom-20 right-5 z-50 flex h-[min(70vh,620px)] w-[560px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22] shadow-2xl">
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-[#21262d] bg-[#0d1117] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[#e6edf3]">AI 翻译</p>
              <p className="text-xs text-[#8b949e]">英文文档智能翻译，保留 Markdown 与代码格式</p>
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

          {/* 输入区 */}
          <div className="border-b border-[#21262d] p-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={"粘贴英文文档…\n\n小技巧：仓库详情页的 README 顶部有「AI 翻译」按钮，可一键翻译全文"}
              disabled={busy}
              rows={4}
              className="w-full resize-none rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3] placeholder-[#8b949e] outline-none transition-colors focus:border-[#58a6ff] disabled:opacity-60"
            />
            <div className="mt-2 flex items-center gap-2">
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={busy}
                className="rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-sm text-[#e6edf3] outline-none transition-colors focus:border-[#58a6ff] disabled:opacity-60"
              >
                {TARGETS.map((t) => (
                  <option key={t.value} value={t.value}>
                    翻译为 {t.label}
                  </option>
                ))}
              </select>
              <button
                onClick={translate}
                disabled={busy || !input.trim()}
                className="rounded-md bg-[#1f6feb] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#388bfd] disabled:opacity-50"
              >
                {busy ? "翻译中…" : "翻译"}
              </button>
              {input && (
                <button
                  onClick={() => setInput("")}
                  disabled={busy}
                  className="ml-auto text-xs text-[#8b949e] transition-colors hover:text-[#e6edf3] disabled:opacity-50"
                >
                  清空
                </button>
              )}
            </div>
          </div>

          {/* 结果区 */}
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {error && (
              <div className="rounded-lg border border-[#f85149]/40 bg-[#f85149]/10 px-3 py-2 text-sm text-[#f85149]">
                {error}
              </div>
            )}
            {!error && !busy && !result && (
              <p className="text-sm text-[#8b949e]">
                翻译结果将在这里显示。支持英文文档、README、技术文章等长文本。
              </p>
            )}
            {busy && !result && <p className="text-sm text-[#8b949e]">正在翻译…</p>}
            {result && (
              <div ref={resultRef} className="markdown-body-chat text-sm leading-relaxed text-[#e6edf3]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
