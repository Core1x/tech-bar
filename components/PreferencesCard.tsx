"use client";
// M5 §11.3 兴趣偏好卡：关注语言 / 关注主题 / 不感兴趣主题 / 首页偏向（新项目·成熟项目），写 preferences.json。
// 边界必须在界面写清：偏好只影响「今日必须看」候选加权，不改变原始榜单与完整信息流。
// 输入用逗号分隔文本，保存时拆分清洗（服务端再消毒一次）。
import { useEffect, useState } from "react";

interface Prefs {
  languages: string[];
  topics: string[];
  negativeTopics: string[];
  bias: "new" | "mature" | "neutral";
}

const csv = (arr: string[]) => arr.join("，").replace(/，/g, ", ");
const parseCsv = (s: string) =>
  s
    .split(/[,，、\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

function ListField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#e6edf3]">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3] placeholder-[#8b949e] outline-none transition-colors focus:border-[#58a6ff]"
      />
      <p className="mt-1 text-[11px] text-[#8b949e]">{hint}</p>
    </div>
  );
}

export function PreferencesCard() {
  const [loaded, setLoaded] = useState(false);
  const [languages, setLanguages] = useState("");
  const [topics, setTopics] = useState("");
  const [negativeTopics, setNegativeTopics] = useState("");
  const [bias, setBias] = useState<Prefs["bias"]>("neutral");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/preferences");
          const j = (await res.json()) as { preferences?: Prefs };
          if (j.preferences) {
            const p = j.preferences;
            setLanguages(csv(p.languages));
            setTopics(csv(p.topics));
            setNegativeTopics(csv(p.negativeTopics));
            setBias(p.bias);
          }
        } catch {
          // 读取失败仍可手动填写保存
        } finally {
          setLoaded(true);
        }
      })();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    const body: Prefs = {
      languages: parseCsv(languages),
      topics: parseCsv(topics),
      negativeTopics: parseCsv(negativeTopics),
      bias,
    };
    try {
      const res = await fetch("/api/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as { ok?: boolean; preferences?: Prefs; error?: string };
      if (res.ok && j.ok && j.preferences) {
        setLanguages(csv(j.preferences.languages));
        setTopics(csv(j.preferences.topics));
        setNegativeTopics(csv(j.preferences.negativeTopics));
        setBias(j.preferences.bias);
        setMsg({ type: "ok", text: "已保存，下次打开首页的「今日必须看」即生效" });
      } else {
        setMsg({ type: "err", text: j.error ?? "保存失败" });
      }
    } catch {
      setMsg({ type: "err", text: "网络异常，保存失败" });
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <div className="h-4 w-1/3 animate-pulse rounded bg-[#21262d]" />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[#8b949e]">
        只影响首页「今日必须看」的候选<b className="text-[#e6edf3]">加权排序</b>，
        <b className="text-[#e6edf3]">不改变</b>原始榜单、完整信息流与热榜。多个词用逗号分隔。
      </p>
      <ListField
        label="关注语言"
        hint="匹配这些编程语言的 GitHub 仓库会加权靠前（如 Rust, TypeScript）"
        value={languages}
        onChange={setLanguages}
        placeholder="Rust, TypeScript, Go"
      />
      <ListField
        label="关注主题"
        hint="命中话题（topic）或匹配词的候选加权"
        value={topics}
        onChange={setTopics}
        placeholder="ai, llm, agent, database"
      />
      <ListField
        label="不感兴趣主题"
        hint="命中的候选会被明显降权（沉底但不删除）"
        value={negativeTopics}
        onChange={setNegativeTopics}
        placeholder="game, blockchain"
      />
      <div>
        <p className="mb-1.5 text-sm font-medium text-[#e6edf3]">首页更偏向</p>
        <div className="flex gap-1 rounded-md border border-[#30363d] bg-[#0d1117] p-0.5">
          {(
            [
              ["new", "新项目"],
              ["neutral", "中立"],
              ["mature", "成熟项目"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setBias(v)}
              className={`flex-1 rounded px-3 py-1.5 text-sm transition-colors ${
                bias === v ? "bg-[#21262d] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-[#238636] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#2ea043] disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存偏好"}
        </button>
        {msg && (
          <span className={`text-xs ${msg.type === "ok" ? "text-[#3fb950]" : "text-[#f85149]"}`}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}
