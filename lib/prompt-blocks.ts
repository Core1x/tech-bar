// 榜单/追踪池数据块构建：聊天 system prompt、洞察生成共用的公共逻辑。
// M2 起为提示词块唯一实现（原 daily.mjs 零依赖复制已删除）。
import type { NewStarRepo, TrackedRepo } from './types';

/** 新星榜文本块（Top N），聊天与洞察生成共用同一格式 */
export function buildNewStarsBlock(newStars: NewStarRepo[], limit = 20): string {
  return newStars
    .slice(0, limit)
    .map(
      (r) => `- ${r.full_name}｜star ${r.stars}｜${r.language ?? '未知语言'}｜${r.summary || r.description || '（无描述）'}`,
    )
    .join('\n');
}

/** 追踪池按 delta_1d 降序取前 N（delta 为 null 的排最后） */
export function deltaTopTracked(tracked: TrackedRepo[], limit = 10): TrackedRepo[] {
  return [...tracked]
    .sort((a, b) => (b.delta_1d ?? -1) - (a.delta_1d ?? -1))
    .slice(0, limit);
}

/** 追踪池 delta Top N 文本块（聊天用格式） */
export function buildDeltaBlock(tracked: TrackedRepo[], limit = 10): string {
  return deltaTopTracked(tracked, limit)
    .map((r) => `- ${r.full_name}｜${r.delta_1d ?? '—'} star（今日）｜总 star ${r.stars}｜${r.language ?? '未知语言'}`)
    .join('\n');
}
