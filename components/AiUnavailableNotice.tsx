// 「未配置 AI 接入」提示：无 AI key 时替代各 AI 块的「生成」按钮（直接告知 + 引导去设置），
// 避免"点了才报 503"。复用面：AiInsight(判读/评测)、SimilarProjects(同类)、FeedSummary(跨源综述)。
import Link from "next/link";

export function AiUnavailableNotice({ what }: { what?: string }) {
  return (
    <p className="text-sm text-[#8b949e]">
      未配置 AI 接入，无法生成{what ? `「${what}」` : ""}。
      <Link href="/settings" className="ml-1 text-[#58a6ff] hover:underline">
        去「设置」填写 AI Key
      </Link>
    </p>
  );
}
