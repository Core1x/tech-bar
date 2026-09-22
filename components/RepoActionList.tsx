"use client";
// M4（§10.2）：洞察/周报正文提取出的仓库 → 「值得关注的项目」快捷行动行（关注 / 加入对比 / 站内详情）。
// 数据由服务端解析（core/domain/repo-refs#extractRepoRefs）并附关注态；关注切换走全站 watchlist（乐观更新）。
import Link from "next/link";
import { useState } from "react";
import { postWatchToggle } from "./watchApi";
import { CompareButton } from "./CompareButton";

export interface RepoAction {
  fullName: string;
  watched: boolean;
}

export function RepoActionList({ repos }: { repos: RepoAction[] }) {
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(repos.map((r) => [r.fullName, r.watched])),
  );
  const [pending, setPending] = useState<Set<string>>(new Set());

  async function toggle(r: RepoAction) {
    if (pending.has(r.fullName)) return;
    const cur = state[r.fullName] ?? r.watched;
    setState((m) => ({ ...m, [r.fullName]: !cur }));
    setPending((p) => new Set(p).add(r.fullName));
    try {
      const res = await postWatchToggle({
        source: "github",
        sourceId: r.fullName,
        title: r.fullName,
        url: `https://github.com/${r.fullName}`,
      });
      const j = (await res.json()) as { ok?: boolean; watched?: boolean };
      if (!j.ok) setState((m) => ({ ...m, [r.fullName]: cur }));
    } catch {
      setState((m) => ({ ...m, [r.fullName]: cur }));
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(r.fullName);
        return n;
      });
    }
  }

  if (repos.length === 0) return null;
  return (
    <div className="mt-4 border-t border-[#21262d] pt-3">
      <p className="mb-2 text-xs font-semibold text-[#8b949e]">文中点名 · 快捷操作</p>
      <ul className="space-y-1.5">
        {repos.map((r) => {
          const watched = state[r.fullName] ?? r.watched;
          return (
            <li key={r.fullName} className="flex flex-wrap items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => toggle(r)}
                disabled={pending.has(r.fullName)}
                title={watched ? "取消关注" : "加入关注"}
                aria-label={watched ? "取消关注" : "加入关注"}
                className={
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded border text-xs transition-colors " +
                  (watched
                    ? "border-[#e3b341]/50 bg-[#e3b341]/15 text-[#e3b341]"
                    : "border-[#30363d] text-[#8b949e] hover:border-[#8b949e]")
                }
              >
                {watched ? "★" : "☆"}
              </button>
              <Link href={`/repo/${r.fullName}`} className="min-w-0 break-all text-[#58a6ff] hover:underline">
                {r.fullName}
              </Link>
              <CompareButton fullName={r.fullName} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
